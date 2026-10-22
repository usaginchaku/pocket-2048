import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');

function worker(scope = 'https://example.com/games/2048/') {
  const events = {};
  const stored = new Map();
  const deleted = [];
  const fetched = [];
  let precacheRequests = [];
  let claimed = false;
  let skipped = false;
  const cache = {
    addAll: async (requests) => { precacheRequests = requests; },
    match: async (url) => stored.get(url),
  };
  vm.runInNewContext(source, {
    URL,
    Request,
    self: {
      registration: { scope },
      addEventListener: (name, listener) => { events[name] = listener; },
      clients: { claim: async () => { claimed = true; } },
      skipWaiting: async () => { skipped = true; },
    },
    caches: {
      open: async () => cache,
      keys: async () => ['unrelated-cache', 'pocket-2048-v0', 'pocket-2048-v1'],
      delete: async (name) => { deleted.push(name); },
    },
    fetch: async (request) => { fetched.push(request); return 'network'; },
  });
  return {
    events, stored, deleted, fetched,
    get precacheRequests() { return precacheRequests; },
    get claimed() { return claimed; },
    get skipped() { return skipped; },
  };
}

function dispatchLifecycle(worker, eventName, extra = {}) {
  let pending;
  worker.events[eventName]({ ...extra, waitUntil: (promise) => { pending = promise; } });
  return pending;
}

function request(worker, path, overrides = {}) {
  let response;
  worker.events.fetch({
    request: { url: path, method: 'GET', mode: 'cors', ...overrides },
    respondWith: (promise) => { response = promise; },
  });
  return response;
}

test('installation precaches every app asset relative to its deployment scope', async () => {
  const w = worker();
  await dispatchLifecycle(w, 'install');
  assert.equal(w.precacheRequests.length, 10);
  for (const entry of w.precacheRequests) {
    assert.ok(entry.url.startsWith('https://example.com/games/2048/'));
    assert.equal(entry.cache, 'reload');
    assert.equal(entry.credentials, 'same-origin');
  }
  assert.equal(w.skipped, false, 'an installing update must not interrupt an active game');
});

test('activation deletes only old game caches and claims the first loaded game', async () => {
  const w = worker();
  await dispatchLifecycle(w, 'activate');
  assert.deepEqual(w.deleted, ['pocket-2048-v0']);
  assert.equal(w.claimed, true);
});

test('root navigation and index navigation use the cached app shell offline', async () => {
  const w = worker();
  w.stored.set('https://example.com/games/2048/index.html', 'offline game');
  assert.equal(await request(w, 'https://example.com/games/2048/?from=homescreen', { mode: 'navigate' }), 'offline game');
  assert.equal(await request(w, 'https://example.com/games/2048/index.html', { mode: 'navigate' }), 'offline game');
  assert.equal(w.fetched.length, 0);
});

test('known assets use the cache, with a network fallback if evicted', async () => {
  const w = worker();
  w.stored.set('https://example.com/games/2048/engine.js', 'cached engine');
  assert.equal(await request(w, 'https://example.com/games/2048/engine.js'), 'cached engine');
  assert.equal(await request(w, 'https://example.com/games/2048/styles.css'), 'network');
  assert.equal(w.fetched.length, 1);
});

test('external requests, writes, login and unknown routes remain untouched', () => {
  const w = worker();
  assert.equal(request(w, 'https://other.example/app.js'), undefined);
  assert.equal(request(w, 'https://example.com/games/2048/app.js', { method: 'POST' }), undefined);
  assert.equal(request(w, 'https://example.com/games/2048/login', { mode: 'navigate' }), undefined);
  assert.equal(request(w, 'https://example.com/auth/callback', { mode: 'navigate' }), undefined);
});

test('an update activates early only after an explicit message', async () => {
  const w = worker();
  await dispatchLifecycle(w, 'message', { data: { type: 'OTHER' } });
  assert.equal(w.skipped, false);
  await dispatchLifecycle(w, 'message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(w.skipped, true);
});
