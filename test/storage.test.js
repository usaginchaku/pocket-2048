import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, moveGame } from '../dist/engine.js';
import { SAVE_KEY, readSave, writeSave } from '../dist/storage.js';

class MemoryStorage {
  constructor(entries = []) { this.values = new Map(entries); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
}

function savedStorage(overrides = {}) {
  return new MemoryStorage([[SAVE_KEY, JSON.stringify({
    version: 1,
    state: createGame(() => 0),
    previous: null,
    best: 0,
    savedAt: 1,
    ...overrides,
  })]]);
}

test('an empty store starts a new game without modifying unrelated data', () => {
  const storage = new MemoryStorage([['unrelated', 'keep me']]);
  assert.deepEqual(readSave(storage), { state: null, previous: null, best: 0, status: 'new' });
  assert.equal(storage.getItem('unrelated'), 'keep me');
  assert.equal(storage.getItem(SAVE_KEY), null);
});

test('a saved move and undo snapshot survive a fresh load without sharing references', () => {
  const storage = new MemoryStorage();
  const previous = createGame(() => 0);
  const state = moveGame(previous, 'left', () => 0).state;
  assert.equal(writeSave(storage, state, previous, 128), true);
  const reloaded = readSave(storage);
  assert.equal(reloaded.status, 'loaded');
  assert.deepEqual(reloaded.state, state);
  assert.deepEqual(reloaded.previous, previous);
  assert.equal(reloaded.best, 128);
  assert.notStrictEqual(reloaded.state.board, state.board);
  assert.notStrictEqual(reloaded.previous.board, previous.board);
  reloaded.state.board[0] = 1024;
  assert.deepEqual(readSave(storage).state, state);
});

test('each successful save replaces the current game atomically under the same versioned key', () => {
  const storage = new MemoryStorage([['unrelated', 'keep me']]);
  const initial = createGame(() => 0);
  const moved = moveGame(initial, 'left', () => 0).state;
  writeSave(storage, initial, null, 0);
  writeSave(storage, moved, initial, moved.score);
  const payload = JSON.parse(storage.getItem(SAVE_KEY));
  assert.equal(payload.version, 1);
  assert.deepEqual(payload.state, moved);
  assert.deepEqual(payload.previous, initial);
  assert.ok(Number.isSafeInteger(payload.savedAt));
  assert.ok(payload.savedAt > 0 && payload.savedAt <= Date.now());
  assert.equal(storage.values.size, 2);
  assert.equal(storage.getItem('unrelated'), 'keep me');
});

test('best score is at least both the current and undo scores', () => {
  const base = createGame(() => 0);
  for (const [currentScore, previousScore, savedBest, expected] of [
    [400, 300, 200, 400],
    [200, 600, 100, 600],
    [200, 300, 900, 900],
    [0, 0, 0, 0],
  ]) {
    const storage = savedStorage({
      state: { ...base, score: currentScore },
      previous: { ...base, score: previousScore },
      best: savedBest,
    });
    assert.equal(readSave(storage).best, expected);
  }
});

test('invalid best scores are discarded while the valid game and earned score survive', () => {
  const state = { ...createGame(() => 0), score: 88 };
  for (const best of [-1, 1.2, '9999', null, false, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
    const loaded = readSave(savedStorage({ state, best }));
    assert.equal(loaded.status, 'loaded');
    assert.equal(loaded.best, 88);
    assert.deepEqual(loaded.state, state);
  }
});

test('missing or corrupt undo snapshots do not discard the current game', () => {
  for (const previous of [null, undefined, 'bad', [], {}, { board: [2], score: 9000 }]) {
    const storage = savedStorage({ previous });
    const loaded = readSave(storage);
    assert.equal(loaded.status, 'loaded');
    assert.equal(loaded.previous, null);
    assert.equal(loaded.best, 0);
    assert.ok(loaded.state);
  }
});

test('saved outcome flags are normalized for both the current and previous games', () => {
  const base = createGame(() => 0);
  const current = { ...base, board: [2048, 2, ...Array(14).fill(0)], won: false, over: true, keepPlaying: true };
  const previous = { ...base, won: true, over: true, keepPlaying: true };
  const loaded = readSave(savedStorage({ state: current, previous }));
  assert.equal(loaded.state.won, true);
  assert.equal(loaded.state.over, false);
  assert.equal(loaded.state.keepPlaying, true);
  assert.equal(loaded.previous.won, false);
  assert.equal(loaded.previous.over, false);
  assert.equal(loaded.previous.keepPlaying, false);
});

test('truncated JSON, foreign versions, and malformed current state are handled without throwing', () => {
  const valid = JSON.parse(savedStorage().getItem(SAVE_KEY));
  const corruptValues = [
    '{"version":', 'not json', 'null', 'true', '[]', '{}',
    JSON.stringify({ ...valid, version: 0 }),
    JSON.stringify({ ...valid, version: '1' }),
    JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, state: null }),
    JSON.stringify({ ...valid, state: { ...valid.state, board: [2] } }),
  ];
  for (const raw of corruptValues) {
    assert.deepEqual(readSave(new MemoryStorage([[SAVE_KEY, raw]])), {
      state: null, previous: null, best: 0, status: 'unavailable',
    });
  }
});

test('storage access denial and missing browser storage return a recoverable result', () => {
  const denied = {
    getItem() { throw new DOMException('Blocked', 'SecurityError'); },
    setItem() { throw new DOMException('Blocked', 'SecurityError'); },
  };
  for (const storage of [denied, undefined, null, {}]) {
    assert.deepEqual(readSave(storage), { state: null, previous: null, best: 0, status: 'unavailable' });
    assert.equal(writeSave(storage, createGame(() => 0), null, 0), false);
  }
});

test('a quota failure preserves the last successful save and reports failure', () => {
  const storage = savedStorage({ best: 400 });
  const before = storage.getItem(SAVE_KEY);
  storage.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  const state = moveGame(createGame(() => 0), 'left', () => 0).state;
  assert.equal(writeSave(storage, state, null, 800), false);
  assert.equal(storage.getItem(SAVE_KEY), before);
  assert.equal(readSave(storage).best, 400);
});

test('serialization failure reports failure without overwriting an earlier save', () => {
  const storage = savedStorage();
  const before = storage.getItem(SAVE_KEY);
  const cyclic = createGame(() => 0);
  cyclic.extra = cyclic;
  assert.equal(writeSave(storage, cyclic, null, 0), false);
  assert.equal(storage.getItem(SAVE_KEY), before);
});

test('a valid save can recover from a previously corrupted storage entry', () => {
  const storage = new MemoryStorage([[SAVE_KEY, '{broken']]);
  assert.equal(readSave(storage).status, 'unavailable');
  const state = createGame(() => 0);
  assert.equal(writeSave(storage, state, null, 0), true);
  assert.equal(readSave(storage).status, 'loaded');
  assert.deepEqual(readSave(storage).state, state);
});
