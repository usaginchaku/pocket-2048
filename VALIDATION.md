# Verification record

Verified on 2026-10-22 in a Linux browser test environment.

## Rules, persistence, and offline cache

34 automated checks passed with `node --test --test-isolation=none test/*.test.js`:

- All directions, merge ordering, prevention of double merges, score calculation, and non-mutating updates.
- New tile distribution, unchanged moves, win/continue and game-over behavior.
- 1,000 seeded random boards checked for tile conservation and score invariants.
- Save restoration, undo, best score, invalid JSON/state, denied storage, and quota failures.
- Service-worker app shell, scope handling, cache cleanup, and non-disruptive updates.

## Browser behavior

Chromium and WebKit 26.0 cover 15 scenarios each: swipes, rapid queued input (including a no-op between valid moves), reload/undo, reset confirmation, win/continue, game over, screen-reader direction buttons, offline restart, denied storage, corrupt saves, single-screen layout, numeric-only visible text, zoom prevention, and GitHub Pages subpaths.

Chromium swipe tests use browser-dispatched touch events. WebKit swipe tests exercise PointerEvent handlers; they do not emulate physical iOS touch hardware.

Offline operation was independently verified by stopping the HTTP server, confirming the server was unreachable, and then reloading, navigating, playing and saving from the service-worker cache. This avoids a Linux Playwright/WebKit `context.setOffline(true)` failure that blocks cached requests before the service worker can handle them.

The complete board, scores and controls fit without vertical or horizontal scrolling at 320×460, 320×568, 375×550, 390×664, 390×844, 430×932, 844×390 and 667×320. Screenshots were inspected at 390×664, 320×460 and 667×320. Normal visible text consists of numbers only. Chromium's real two-finger input and double tap leave visualViewport.scale at 1 and do not accidentally move a tile; WebKit tests its Safari gesture-prevention and multitouch handlers. Movement uses short transform animations without per-move layout measurements.

An upgrade from the original v1 files to v2 was also verified in Chromium and WebKit. The new worker activated without reloading the running game, removed the old cache, and preserved the save. After one more move and a reload, the minimal UI restored the exact saved state without browser errors.

## Remaining physical-device verification

Physical iPhone installation through Safari's “Add to Home Screen”, iOS system gestures, and OS-driven storage eviction have not been tested in this environment. Browser engine tests are not a substitute for those device-specific checks.

## GitHub Pages subpath

Two additional browser checks passed, one each in Chromium and WebKit, with the app available only at `/pocket-2048/` and the origin root returning 404. They verify relative scripts/styles, manifest start URL and scope, icon URLs, service-worker script and scope, cache containment, and offline reload/play/navigation/save after the server is stopped.

## Repository hosting

Source repository: https://github.com/usaginchaku/pocket-2048

The Pages workflow validates the app before publishing `dist/`. It requires the repository's Settings → Pages → Source to be set to GitHub Actions.
