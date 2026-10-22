import { createGame, moveGame } from './engine.js';
import { readSave, writeSave } from './storage.js';

const $ = (id) => document.getElementById(id);
const board = $('board');
const tiles = $('tiles');
const dialog = $('new-dialog');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const saved = readSave(storage);
let state = saved.state || createGame();
let previous = saved.previous;
let best = Math.max(saved.best, state.score);
let animationTimer = null;
let animations = [];
let inputQueue = [];
let gesture = null;
let multiTouch = false;
let lastResult = '';
let tileStep = (board.clientWidth - 8) / 4;

// Fixed background cells; only the sixteen small tile faces change during play.
document.querySelector('.grid').append(...Array.from({ length: 16 }, () => {
  const cell = document.createElement('div'); cell.className = 'cell'; return cell;
}));

function persist() {
  best = Math.max(best, state.score);
  $('storage-warning').hidden = writeSave(storage, state, previous, best);
}

function drawBoard(spawnedIndex = null, mergedIndices = []) {
  tiles.replaceChildren(...state.board.flatMap((value, index) => {
    if (!value) return [];
    const tile = document.createElement('div');
    const face = document.createElement('span');
    const digits = String(value).length;
    tile.className = 'tile' + (digits >= 3 ? ` digits-${digits > 5 ? 'many' : digits}` : '') + (value > 2048 ? ' high-tile' : '');
    tile.dataset.value = value;
    tile.dataset.index = index;
    tile.style.setProperty('--col', index % 4);
    tile.style.setProperty('--row', Math.floor(index / 4));
    face.className = 'tile-face';
    face.textContent = value;
    tile.append(face);
    if (index === spawnedIndex) tile.classList.add('spawn');
    if (mergedIndices.includes(index)) tile.classList.add('merge');
    return [tile];
  }));
  $('accessible-board').textContent = Array.from({ length: 4 }, (_, row) =>
    `${row + 1}行目：${state.board.slice(row * 4, row * 4 + 4).map(n => n || '空き').join('、')}`
  ).join('。');
}

function renderControls() {
  $('score').textContent = state.score.toLocaleString('ja-JP');
  $('best').textContent = best.toLocaleString('ja-JP');
  $('undo-button').disabled = !previous;
  $('result-undo').hidden = !previous;
  const resultType = state.won && !state.keepPlaying ? 'win' : state.over ? 'over' : '';
  $('result').hidden = !resultType;
  board.tabIndex = resultType ? -1 : 0;
  if (resultType) {
    const won = resultType === 'win';
    $('result-title').textContent = won ? '2048' : '終了';
    $('continue-button').hidden = !won;
    $('retry-button').hidden = won;
    if (resultType !== lastResult && !dialog.open) {
      (won ? $('continue-button') : $('retry-button')).focus({ preventScroll: true });
      $('announcement').textContent = won ? '2048達成' : `ゲーム終了。スコア ${state.score}`;
    }
  }
  lastResult = resultType;
}

function clearAnimation() {
  clearTimeout(animationTimer);
  animationTimer = null;
  for (const animation of animations) animation.cancel();
  animations = [];
}

function finishAnimation(result) {
  clearAnimation();
  drawBoard(result.spawnedIndex, result.transitions.filter(t => t.merged).map(t => t.to));
  renderControls();
  while (inputQueue.length && animationTimer === null && !dialog.open) requestMove(inputQueue.shift());
}

function tilePosition(index) {
  return `translate3d(${index % 4 * tileStep}px, ${Math.floor(index / 4) * tileStep}px, 0)`;
}

function requestMove(direction) {
  if (dialog.open) return;
  if (animationTimer !== null) {
    if (inputQueue.length < 8) inputQueue.push(direction);
    return;
  }
  const result = moveGame(state, direction);
  if (!result.changed) return;
  previous = state;
  state = result.state;
  persist(); // Commit the entire turn before drawing or any lifecycle event.
  $('score').textContent = state.score.toLocaleString('ja-JP');
  $('best').textContent = best.toLocaleString('ja-JP');
  $('announcement').textContent = `スコア ${state.score}`;
  if (reduceMotion.matches || !board.animate) { finishAnimation(result); return; }
  for (const transition of result.transitions) {
    if (transition.from === transition.to) continue;
    const tile = tiles.querySelector(`[data-index="${transition.from}"]`);
    if (!tile) continue;
    if (transition.merged) tile.style.zIndex = '2';
    animations.push(tile.animate([
      { transform: tilePosition(transition.from) },
      { transform: tilePosition(transition.to) },
    ], { duration: 85, easing: 'ease-out', fill: 'forwards' }));
  }
  animationTimer = setTimeout(() => finishAnimation(result), 90);
}

function stopMotion() {
  inputQueue = [];
  clearAnimation();
  gesture = null;
}

function undo() {
  if (!previous) return;
  stopMotion();
  state = previous;
  previous = null;
  persist();
  drawBoard();
  renderControls();
  $('announcement').textContent = '1手戻しました';
  board.focus({ preventScroll: true });
}

function openNewGame() {
  stopMotion();
  drawBoard();
  renderControls();
  dialog.showModal();
  $('cancel-new').focus();
}

$('new-button').addEventListener('click', openNewGame);
$('retry-button').addEventListener('click', openNewGame);
$('cancel-new').addEventListener('click', () => dialog.close());
$('confirm-new').addEventListener('click', () => {
  stopMotion();
  state = createGame();
  previous = null;
  persist();
  dialog.close();
  drawBoard();
  renderControls();
  board.focus({ preventScroll: true });
});
$('undo-button').addEventListener('click', undo);
$('result-undo').addEventListener('click', undo);
$('continue-button').addEventListener('click', () => {
  state = { ...state, keepPlaying: true };
  persist();
  renderControls();
  if (!state.over) board.focus({ preventScroll: true });
});
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});

board.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || multiTouch) { gesture = null; return; }
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
  board.setPointerCapture(event.pointerId);
});
board.addEventListener('pointerup', (event) => {
  if (!gesture || event.pointerId !== gesture.id || multiTouch) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  gesture = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
  requestMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
});
board.addEventListener('pointercancel', () => { gesture = null; });
board.addEventListener('lostpointercapture', () => { gesture = null; });

// iOS Safari can ignore viewport zoom limits. Suppress its gesture path as well.
for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(name, (event) => { gesture = null; event.preventDefault(); }, { passive: false });
}
for (const name of ['touchstart', 'touchmove']) {
  document.addEventListener(name, (event) => {
    if (event.touches.length > 1) { multiTouch = true; gesture = null; event.preventDefault(); }
  }, { passive: false });
}
for (const name of ['touchend', 'touchcancel']) {
  document.addEventListener(name, (event) => {
    if (multiTouch) { gesture = null; event.preventDefault(); }
    if (!event.touches.length) multiTouch = false;
  }, { passive: false });
}
document.addEventListener('dblclick', (event) => event.preventDefault());
document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('wheel', (event) => { if (event.ctrlKey) event.preventDefault(); }, { passive: false });
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key)) { event.preventDefault(); return; }
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing || dialog.open) return;
  const direction = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' }[event.key];
  if (direction) { event.preventDefault(); requestMove(direction); }
});
for (const button of document.querySelectorAll('[data-direction]')) button.addEventListener('click', () => requestMove(button.dataset.direction));
new ResizeObserver(([entry]) => {
  tileStep = (entry.contentRect.width - 8) / 4;
  if (animationTimer !== null) { stopMotion(); drawBoard(); renderControls(); }
}).observe(board);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { stopMotion(); persist(); drawBoard(); renderControls(); }
});
window.addEventListener('pagehide', persist);

persist();
drawBoard();
renderControls();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
