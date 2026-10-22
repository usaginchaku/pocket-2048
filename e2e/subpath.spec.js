import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

test('GitHub Pages subpath installs and stays playable with the origin offline', async ({ page }) => {
  const root = resolve('dist');
  const prefix = '/pocket-2048/';
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml', '.png': 'image/png',
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
      const relative = pathname.slice(prefix.length) || 'index.html';
      const file = resolve(root, relative);
      if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = origin + prefix;
  const stop = () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  try {
    await page.addInitScript(() => {
      Math.random = () => 0.1;
      if (!localStorage.getItem('pocket-2048.save.v1')) {
        localStorage.setItem('pocket-2048.save.v1', JSON.stringify({
          version: 1, best: 0, previous: null,
          state: { board: [2,2,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0], score: 0, moves: 0, won: false, keepPlaying: false, over: false },
        }));
      }
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const loaded = await page.goto(base);
    expect(loaded.status()).toBe(200);
    await expect(page.locator('#board')).toBeVisible();
    await expect(page.locator('.tile')).toHaveCount(2);
    expect((await fetch(origin + '/')).status).toBe(404);

    const install = await page.evaluate(async () => {
      const manifestURL = document.querySelector('link[rel="manifest"]').href;
      const manifest = await (await fetch(manifestURL)).json();
      const registration = await navigator.serviceWorker.ready;
      const cacheNames = await caches.keys();
      const cache = await caches.open(cacheNames.find(name => name.startsWith('pocket-2048-')));
      return {
        manifestURL,
        startURL: new URL(manifest.start_url, manifestURL).href,
        manifestScope: new URL(manifest.scope, manifestURL).href,
        icons: manifest.icons.map(icon => new URL(icon.src, manifestURL).href),
        workerScope: registration.scope,
        workerScript: registration.active.scriptURL,
        cachedURLs: (await cache.keys()).map(request => request.url),
      };
    });
    expect(install.manifestURL).toBe(base + 'manifest.webmanifest');
    expect(install.startURL).toBe(base);
    expect(install.manifestScope).toBe(base);
    expect(install.workerScope).toBe(base);
    expect(install.workerScript).toBe(base + 'sw.js');
    expect(install.icons.every(url => url.startsWith(base + 'icons/'))).toBe(true);
    expect(install.cachedURLs).toContain(base + 'index.html');
    expect(install.cachedURLs).toContain(base + 'app.js');
    expect(install.cachedURLs).toContain(base + 'styles.css');
    expect(install.cachedURLs.every(url => url.startsWith(base))).toBe(true);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(base + 'sw.js');
    expect(errors).toEqual([]);

    // A dead origin tests the actual service-worker fallback in both engines.
    await stop();
    expect(await fetch(base).then(() => true, () => false)).toBe(false);
    await page.reload();
    await expect(page.locator('#board')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#score')).toHaveText('4');
    await page.goto(base + 'index.html');
    await expect(page.locator('#score')).toHaveText('4');
    await expect(page.locator('#storage-warning')).toBeHidden();
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('pocket-2048.save.v1')).state);
    expect(restored.board[0]).toBe(4);
    expect(restored.moves).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    if (server.listening) await stop();
  }
});
