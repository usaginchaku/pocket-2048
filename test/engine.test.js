import test from 'node:test';
import assert from 'node:assert/strict';
import { canMove, createGame, isValidState, moveGame, normalizeState } from '../dist/engine.js';

const empty = () => Array(16).fill(0);
function state(board, extra = {}) {
  return { board, score: 0, moves: 0, won: false, keepPlaying: false, over: false, ...extra };
}
function sequence(...values) {
  let index = 0;
  return () => {
    assert.ok(index < values.length, 'randomness must be requested only as needed');
    return values[index++];
  };
}
const noRandom = () => { throw new Error('This operation must not request randomness.'); };
const withoutSpawn = result => result.state.board.map((value, index) => index === result.spawnedIndex ? 0 : value);

test('new games contain two distinct tiles with the expected 2/4 distribution', () => {
  const game = createGame(sequence(0, 0.899, 0.999, 0.9));
  assert.equal(game.board[0], 2);
  assert.equal(game.board[15], 4);
  assert.equal(game.board.filter(Boolean).length, 2);
  assert.deepEqual({ ...game, board: [] }, { board: [], score: 0, moves: 0, won: false, keepPlaying: false, over: false });
  assert.equal(isValidState(game), true);
});

test('left compacts gaps and merges equal neighbors exactly once', () => {
  const input = state([2, 0, 2, 4, 2, 2, 2, 2, 4, 4, 8, 0, 0, 2, 2, 2]);
  const result = moveGame(input, 'left', sequence(0, 0));
  assert.deepEqual(withoutSpawn(result), [4, 4, 0, 0, 4, 4, 0, 0, 8, 8, 0, 0, 4, 2, 0, 0]);
  assert.equal(result.state.score, 24);
  assert.equal(result.state.moves, 1);
  assert.equal(result.state.board[result.spawnedIndex], 2);
});

test('right merges from the destination edge', () => {
  const result = moveGame(state([2, 2, 2, 0, ...Array(12).fill(0)]), 'right', sequence(0, 0));
  assert.deepEqual(withoutSpawn(result).slice(0, 4), [0, 0, 2, 4]);
  assert.equal(result.state.score, 4);
});

test('up and down use the same rules on columns without row wrapping', () => {
  const board = [2, 0, 4, 0, 0, 2, 4, 0, 2, 2, 8, 0, 4, 2, 8, 0];
  const up = moveGame(state(board), 'up', sequence(0, 0));
  const down = moveGame(state(board), 'down', sequence(0, 0));
  assert.deepEqual(withoutSpawn(up), [4, 4, 8, 0, 4, 2, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(withoutSpawn(down), [0, 0, 0, 0, 0, 0, 0, 0, 4, 2, 8, 0, 4, 4, 16, 0]);
  assert.equal(up.state.score, 32);
  assert.equal(down.state.score, 32);
});

test('animation transitions account for every original tile, including both merge inputs', () => {
  const result = moveGame(state([0, 2, 2, 4, ...Array(12).fill(0)]), 'left', sequence(0, 0));
  assert.deepEqual(result.transitions, [
    { from: 1, to: 0, value: 2, merged: true },
    { from: 2, to: 0, value: 2, merged: true },
    { from: 3, to: 1, value: 4, merged: false },
  ]);
});

test('invalid and no-op moves preserve state identity and never consume randomness', () => {
  const input = state([2, 4, 0, 0, ...Array(12).fill(0)], { score: 12, moves: 3 });
  for (const direction of ['left', 'up', 'diagonal', null]) {
    const result = moveGame(input, direction, noRandom);
    assert.strictEqual(result.state, input);
    assert.equal(result.changed, false);
    assert.deepEqual(result.transitions, []);
    assert.equal(result.spawnedIndex, null);
  }
  const invalid = { board: [2] };
  assert.strictEqual(moveGame(invalid, 'left', noRandom).state, invalid);
});

test('movement does not mutate the supplied state or board', () => {
  const input = Object.freeze(state(Object.freeze([0, 2, 2, 0, ...Array(12).fill(0)])));
  const result = moveGame(input, 'left', sequence(0, 0));
  assert.notStrictEqual(result.state, input);
  assert.equal(input.board[0], 0);
  assert.equal(input.score, 0);
  assert.equal(input.moves, 0);
});

test('full boards detect horizontal and vertical opportunities, but never diagonal ones', () => {
  const locked = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
  assert.equal(canMove(locked), false);
  const horizontal = locked.slice();
  horizontal[1] = 2;
  assert.equal(canMove(horizontal), true);
  const vertical = locked.slice();
  vertical[4] = 2;
  assert.equal(canMove(vertical), true);
  assert.equal(canMove(empty()), false);
  assert.equal(canMove([2]), false);
  assert.strictEqual(moveGame(state(locked), 'left', noRandom).changed, false);
});

test('a spawn can finish the game and marks it over immediately', () => {
  const board = [0, 2, 4, 2, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2];
  const result = moveGame(state(board), 'left', sequence(0, 0.9));
  assert.equal(result.changed, true);
  assert.equal(result.spawnedIndex, 3);
  assert.equal(result.state.over, true);
  assert.equal(canMove(result.state.board), false);
});

test('reaching 2048 pauses once and explicit continuation enables larger tiles', () => {
  const board = [1024, 1024, 0, 0, ...Array(12).fill(0)];
  const won = moveGame(state(board), 'left', sequence(0, 0)).state;
  assert.equal(won.won, true);
  assert.equal(won.keepPlaying, false);
  assert.equal(won.score, 2048);
  assert.equal(moveGame(won, 'right', noRandom).changed, false);
  const continued = moveGame({ ...won, keepPlaying: true }, 'right', sequence(0, 0));
  assert.equal(continued.changed, true);
  assert.equal(continued.state.keepPlaying, true);
  const larger = moveGame(state([2048, 2048, 0, 0, ...Array(12).fill(0)], { won: true, keepPlaying: true }), 'left', sequence(0, 0));
  assert.equal(larger.state.board[0], 4096);
  assert.equal(larger.state.score, 4096);
});

test('saved states are cloned and outcome flags repaired from the actual board', () => {
  const input = state([2048, 2, 0, 0, ...Array(12).fill(0)], { over: true, keepPlaying: true });
  const repaired = normalizeState(input);
  assert.equal(repaired.won, true);
  assert.equal(repaired.over, false);
  assert.equal(repaired.keepPlaying, true);
  assert.notStrictEqual(repaired.board, input.board);
  assert.equal(input.won, false);
  assert.equal(normalizeState(state([2, ...Array(15).fill(0)], { keepPlaying: true })).keepPlaying, false);
});

test('malformed and hostile saved state shapes are rejected', () => {
  const valid = createGame(() => 0);
  const corrupt = [
    null, undefined, [], 'save', {},
    { ...valid, board: Array(16).fill(0) },
    { ...valid, board: [2, 2] },
    { ...valid, board: [2, 2, ...Array(14)] },
    { ...valid, board: [2, 3, ...Array(14).fill(0)] },
    { ...valid, board: [2, '2', ...Array(14).fill(0)] },
    { ...valid, board: [2, -2, ...Array(14).fill(0)] },
    { ...valid, board: [2, Infinity, ...Array(14).fill(0)] },
    { ...valid, board: [2, 2 ** 53, ...Array(14).fill(0)] },
    { ...valid, board: [2, Number.MAX_SAFE_INTEGER, ...Array(14).fill(0)] },
    { ...valid, score: -1 }, { ...valid, score: 1.5 }, { ...valid, score: '4' },
    { ...valid, score: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, moves: -1 }, { ...valid, moves: NaN },
    { ...valid, won: 'false' }, { ...valid, over: null }, { ...valid, keepPlaying: undefined },
  ];
  for (const input of corrupt) {
    assert.equal(normalizeState(input), null);
    assert.equal(isValidState(input), false);
  }
});

test('seeded random boards conserve tile mass, score merges, and spawn exactly once', () => {
  let seed = 0x20482048;
  const rng = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const directions = ['left', 'right', 'up', 'down'];
  for (let trial = 0; trial < 1000; trial += 1) {
    const board = Array.from({ length: 16 }, () => rng() < 0.3 ? 0 : 2 ** (1 + Math.floor(rng() * 8)));
    if (!board.some(Boolean)) board[0] = 2;
    const input = state(board, { score: 100, moves: 5 });
    const before = JSON.stringify(input);
    const result = moveGame(input, directions[trial % 4], rng);
    assert.equal(JSON.stringify(input), before);
    if (!result.changed) {
      assert.strictEqual(result.state, input);
      continue;
    }
    const spawnValue = result.state.board[result.spawnedIndex];
    assert.ok(spawnValue === 2 || spawnValue === 4);
    assert.equal(result.state.board.reduce((a, b) => a + b, 0), board.reduce((a, b) => a + b, 0) + spawnValue);
    assert.equal(result.transitions.length, board.filter(Boolean).length);
    assert.equal(result.state.score - input.score, result.transitions.filter(tile => tile.merged).reduce((sum, tile) => sum + tile.value, 0));
    assert.equal(result.state.moves, 6);
    assert.equal(result.state.over, !canMove(result.state.board));
    const occupiedDestinations = new Set(result.transitions.map(tile => tile.to));
    assert.equal(occupiedDestinations.has(result.spawnedIndex), false);
    assert.equal(result.state.board.filter(Boolean).length, occupiedDestinations.size + 1);
  }
});

test('newly merged tiles never merge a second time in the same move', () => {
  const result = moveGame(state([2, 2, 4, 4, ...Array(12).fill(0)]), 'left', sequence(0, 0));
  assert.deepEqual(withoutSpawn(result).slice(0, 4), [4, 8, 0, 0]);
  assert.equal(result.state.score, 12);
});

test('invalid random sources fail explicitly without mutating input', () => {
  assert.throws(() => createGame(() => 1), RangeError);
  const input = state([0, 2, 0, 0, ...Array(12).fill(0)]);
  const before = JSON.stringify(input);
  assert.throws(() => moveGame(input, 'left', () => -0.1), RangeError);
  assert.equal(JSON.stringify(input), before);
});
