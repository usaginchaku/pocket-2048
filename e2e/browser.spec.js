import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const key = 'pocket-2048.save.v1';
const basicBoard = [2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
function game(board = basicBoard, extra = {}) {
  return { board, score: 0, moves: 0, won: false, keepPlaying: false, over: false, ...extra };
}
async function seed(page, state = game(), extra = {}, rng = 0.1, url = '/') {
  await page.addInitScript(({ key, state, extra, rng }) => {
    Math.random = () => rng;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({version: 1, state, previous: null, best: 0, ...extra}));
  }, { key, state, extra, rng });
  await page.goto(url);
  await expect(page.locator('#score')).toBeVisible();
}
async function save(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
}
async function expectMoves(page, moves) {
  await expect.poll(async () => (await save(page)).state.moves).toBe(moves);
}
async function renderedBoard(page) {
  return page.locator('.tile').evaluateAll(nodes => {
    const board = Array(16).fill(0);
    for (const node of nodes) board[Number(node.dataset.index)] = Number(node.dataset.value);
    return board;
  });
}
async function swipe(page, direction) {
  const box = await page.locator('#board').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const delta = {left: [-90, 0], right: [90, 0], up: [0, -90], down: [0, 90]}[direction];
  if (page.context().browser().browserType().name() !== 'chromium') {
    const pointer = { pointerId: 1, pointerType: 'touch', isPrimary: true, buttons: 1, clientX: x, clientY: y };
    // WebKit has no CDP touch dispatcher. Exercise its PointerEvent handlers.
    await page.locator('#board').evaluate((node, {pointer, delta}) => {
      const original = node.setPointerCapture;
      node.setPointerCapture = () => {};
      node.dispatchEvent(new PointerEvent('pointerdown', {...pointer, bubbles: true}));
      node.dispatchEvent(new PointerEvent('pointerup', {...pointer, buttons: 0, clientX: pointer.clientX + delta[0], clientY: pointer.clientY + delta[1], bubbles: true}));
      node.setPointerCapture = original;
    }, {pointer, delta});
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + delta[0], y: y + delta[1]}]});
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await cdp.detach();
}

test('swipe merges, scores, and survives reload with undo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await seed(page);
  await swipe(page, 'left');
  await expect(page.locator('#score')).toHaveText('4');
  await expectMoves(page, 1);
  const before = await save(page);
  expect(before.state.board[0]).toBe(4);
  expect(before.state.board.filter(Boolean)).toHaveLength(2);
  await page.reload();
  expect((await save(page)).state).toEqual(before.state);
  await expect(page.locator('#score')).toHaveText('4');
  await page.locator('#undo-button').click();
  expect((await save(page)).state.board).toEqual(basicBoard);
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#best')).toHaveText('4');
  await expect(page.locator('#undo-button')).toBeDisabled();
  await page.reload();
  await expect(page.locator('#undo-button')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('all four touch directions move tiles without scrolling the page', async ({ page }) => {
  await seed(page, game([0,0,0,0, 0,2,0,0, 0,0,0,0, 0,0,0,0]));
  for (const [index, direction] of ['right', 'down', 'left', 'up'].entries()) {
    await swipe(page, direction);
    await expectMoves(page, index + 1);
  }
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('rapid inputs finish consistently and save before animation completes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await seed(page);
  await page.keyboard.press('ArrowLeft');
  expect((await save(page)).state.score).toBe(4);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await expectMoves(page, 4);
  const persisted = (await save(page)).state;
  await expect.poll(() => renderedBoard(page)).toEqual(persisted.board);
  await page.reload();
  expect((await save(page)).state).toEqual(persisted);
});

test('a queued no-op does not strand the valid swipe behind it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await seed(page, game([2,4,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]), {}, 0.99);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expectMoves(page, 2);
  expect((await save(page)).state.moves).toBe(2);
});

test('delayed initial resize notification preserves queued moves', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const NativeResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class {
      constructor(callback) {
        let first = true;
        this.observer = new NativeResizeObserver(entries => {
          if (first) {
            first = false;
            window.deliverInitialResize = () => callback(entries, this);
          } else callback(entries, this);
        });
      }
      observe(...args) { this.observer.observe(...args); }
      unobserve(...args) { this.observer.unobserve(...args); }
      disconnect() { this.observer.disconnect(); }
    };
  });
  await seed(page);
  await page.waitForFunction(() => typeof window.deliverInitialResize === 'function');
  await page.evaluate(() => {
    for (const key of ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    window.deliverInitialResize();
  });
  await expectMoves(page, 4);
  const persisted = (await save(page)).state;
  await expect.poll(() => renderedBoard(page)).toEqual(persisted.board);
});

test('new game asks for confirmation, cancel preserves game, best survives reset', async ({ page }) => {
  await seed(page, game(basicBoard, {score: 120, moves: 12}), {best: 240});
  const initial = (await save(page)).state;
  await page.locator('#new-button').click();
  await expect(page.locator('#new-dialog')).toBeVisible();
  await page.locator('#cancel-new').click();
  expect((await save(page)).state).toEqual(initial);
  await page.locator('#new-button').click();
  await page.locator('#confirm-new').click();
  const restarted = await save(page);
  expect(restarted.state.score).toBe(0);
  expect(restarted.state.moves).toBe(0);
  expect(restarted.state.board.filter(Boolean)).toHaveLength(2);
  expect(restarted.best).toBe(240);
  await expect(page.locator('#undo-button')).toBeDisabled();
});

test('2048 win pauses moves and can continue after reload', async ({ page }) => {
  await seed(page, game([1024,1024,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]));
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#result-title')).toHaveText('2048');
  const won = (await save(page)).state;
  await page.keyboard.press('ArrowDown');
  expect((await save(page)).state).toEqual(won);
  await page.reload();
  await expect(page.locator('#result-title')).toHaveText('2048');
  await page.locator('#continue-button').click();
  await expect(page.locator('#result')).toBeHidden();
  await page.keyboard.press('ArrowDown');
  await expectMoves(page, 2);
  await page.reload();
  await expect(page.locator('#result')).toBeHidden();
  expect((await save(page)).state.keepPlaying).toBe(true);
});

test('game over is detected on load and undo can recover the prior game', async ({ page }) => {
  const over = game([2,4,2,4, 4,2,4,2, 2,4,2,4, 4,2,4,2], {score: 100, moves: 20});
  await seed(page, over, {previous: game()});
  await expect(page.locator('#result-title')).toHaveText('終了');
  await page.locator('#result-undo').click();
  await expect(page.locator('#result')).toBeHidden();
  await expect(page.locator('#undo-button')).toBeDisabled();
  expect((await save(page)).state.board).toEqual(basicBoard);
});

test('reset dialog blocks keyboard moves; screen-reader direction actions work', async ({ page }) => {
  await seed(page);
  await page.locator('#new-button').click();
  await expect(page.locator('#new-dialog')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#score')).toHaveText('0');
  await page.keyboard.press('Escape');
  await expect(page.locator('#new-dialog')).toBeHidden();
  await page.locator('[data-direction="left"]').dispatchEvent('click');
  await expect(page.locator('#score')).toHaveText('4');
});

test('service worker supports offline reload, navigation, play, and save', async ({ page }) => {
  // Stop a real origin instead of context.setOffline: WebKit's emulation fails
  // cached service-worker requests with an internal browser error before dispatch.
  const origin = 'http://127.0.0.1:4174';
  const server = spawn(process.execPath, ['scripts/serve.mjs'], {
    env: {...process.env, PORT: '4174'}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stopped = new Promise(resolve => server.once('exit', resolve));
  try {
    await new Promise((resolve, reject) => {
      server.stdout.once('data', resolve);
      server.once('error', reject);
      server.once('exit', code => reject(new Error(`Isolated test server exited: ${code}`)));
    });
    await seed(page, game(), {}, 0.1, origin + '/');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const cached = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const cache = await caches.open(cacheNames.find(name => name.startsWith('pocket-2048-')));
      return (await cache.keys()).map(request => request.url);
    });
    expect(cached).toHaveLength(10);
    server.kill();
    await stopped;
    expect(await fetch(origin).then(() => true, () => false)).toBe(false);
    await page.reload();
    await expect(page.locator('#board')).toBeVisible();
    await swipe(page, 'left');
    await expect(page.locator('#score')).toHaveText('4');
    await page.goto(origin + '/index.html');
    await expect(page.locator('#score')).toHaveText('4');
    await expect(page.locator('#storage-warning')).toBeHidden();
    expect((await save(page)).state.moves).toBe(1);
  } finally {
    if (server.exitCode === null && server.signalCode === null) server.kill();
    await stopped;
  }
});

test('denied localStorage does not prevent play and shows honest save status', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {get() { throw new DOMException('Denied', 'SecurityError'); }});
    Math.random = () => 0.1;
  });
  await page.goto('/');
  await expect(page.locator('#storage-warning')).toBeVisible();
  await expect(page.locator('#storage-warning')).toHaveText('保存不可');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#score')).toHaveText('4');
});

test('corrupted save recovers into a new playable game', async ({ page }) => {
  await page.addInitScript(({key}) => localStorage.setItem(key, '{broken'), {key});
  await page.goto('/');
  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('#storage-warning')).toBeHidden();
  expect((await save(page)).state.board.filter(Boolean)).toHaveLength(2);
});

test('board and every primary control fit one screen in portrait and landscape', async ({ page }) => {
  await seed(page, game([2,4,8,16, 32,64,128,256, 512,1024,2,4, 0,0,0,0], {score: 6784, moves: 412}), {best: 12480});
  await mkdir('test-results/screenshots', {recursive: true});
  for (const [width, height] of [[320,460], [320,568], [375,550], [390,664], [390,844], [430,932], [844,390], [667,320]]) {
    await page.setViewportSize({width, height});
    const bounds = await page.locator('#board').boundingBox();
    expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
    for (const selector of ['#board', '#score', '#best', '#undo-button', '#new-button']) {
      const control = page.locator(selector);
      await expect(control).toBeVisible();
      const rect = await control.boundingBox();
      expect(rect.x, `${selector} left edge at ${width}×${height}`).toBeGreaterThanOrEqual(-1);
      expect(rect.y, `${selector} top edge at ${width}×${height}`).toBeGreaterThanOrEqual(-1);
      expect(rect.x + rect.width, `${selector} right edge at ${width}×${height}`).toBeLessThanOrEqual(width + 1);
      expect(rect.y + rect.height, `${selector} bottom edge at ${width}×${height}`).toBeLessThanOrEqual(height + 1);
    }
    const metrics = await page.evaluate(() => {
      scrollTo(1000, 1000);
      return {width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, x: scrollX, y: scrollY};
    });
    expect(metrics.width, `document width at ${width}×${height}`).toBeLessThanOrEqual(width + 1);
    expect(metrics.height, `document height at ${width}×${height}`).toBeLessThanOrEqual(height + 1);
    expect(metrics.x).toBe(0);
    expect(metrics.y).toBe(0);
    const engine = page.context().browser().browserType().name();
    await page.screenshot({path: `test-results/screenshots/${engine}-${width}x${height}.png`, fullPage: true});
  }
});

test('normal game UI contains only score and tile numbers', async ({ page }) => {
  await seed(page, game(basicBoard, {score: 120, moves: 12}), {best: 240});
  const visibleText = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const visible = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      const element = walker.currentNode.parentElement;
      if (!text || !element || element.closest('.sr-only, [hidden], dialog:not([open])')) continue;
      const style = getComputedStyle(element);
      if (!element.getClientRects().length || style.visibility === 'hidden' || style.display === 'none') continue;
      visible.push(text);
    }
    return visible;
  });
  expect(visibleText.length).toBeGreaterThanOrEqual(4);
  for (const text of visibleText) expect(text).toMatch(/^[\d,\s]+$/);
  await expect(page.locator('#help-button, #instructions, #moves, #save-label')).toHaveCount(0);
  await expect(page.locator('#storage-warning')).toBeHidden();
});

test('pinch and double tap do not zoom or accidentally move the game', async ({ page, browserName }) => {
  await seed(page);
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).toMatch(/maximum-scale\s*=\s*1(?:[,.\s]|$)/);
  expect(viewport).toMatch(/user-scalable\s*=\s*no/);
  const before = (await save(page)).state;
  const box = await page.locator('#board').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x:x-30,y,id:1}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x:x-30,y,id:1},{x:x+30,y,id:2}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x:x-90,y,id:1},{x:x+90,y,id:2}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await cdp.detach();
  } else {
    const result = await page.locator('#board').evaluate((node, {x, y}) => {
      const original = node.setPointerCapture;
      node.setPointerCapture = () => {};
      node.dispatchEvent(new PointerEvent('pointerdown', {pointerId:1,pointerType:'touch',isPrimary:true,clientX:x-30,clientY:y,bubbles:true}));
      node.dispatchEvent(new PointerEvent('pointerdown', {pointerId:2,pointerType:'touch',isPrimary:false,clientX:x+30,clientY:y,bubbles:true}));
      const start = new Event('gesturestart', {bubbles:true,cancelable:true});
      const change = new Event('gesturechange', {bubbles:true,cancelable:true});
      node.dispatchEvent(start);
      node.dispatchEvent(change);
      node.dispatchEvent(new PointerEvent('pointerup', {pointerId:1,pointerType:'touch',isPrimary:true,clientX:x-90,clientY:y,bubbles:true}));
      node.dispatchEvent(new PointerEvent('pointerup', {pointerId:2,pointerType:'touch',isPrimary:false,clientX:x+90,clientY:y,bubbles:true}));
      node.setPointerCapture = original;
      return {startPrevented:start.defaultPrevented,changePrevented:change.defaultPrevented};
    }, {x, y});
    expect(result).toEqual({startPrevented:true,changePrevented:true});
  }
  await page.touchscreen.tap(x, y);
  await page.touchscreen.tap(x, y);
  expect((await save(page)).state).toEqual(before);
  expect(await page.evaluate(() => visualViewport.scale)).toBe(1);
  await swipe(page, 'left');
  await expect(page.locator('#score')).toHaveText('4');
});
