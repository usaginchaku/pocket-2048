import { createGame, moveGame } from './engine.js';
import { readSave, writeSave } from './storage.js';

const $ = (id) => document.getElementById(id);
const board = $('board');
const tiles = $('tiles');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const saved = readSave(storage);
let state = saved.state || createGame();
let previous = saved.previous;
let best = Math.max(saved.best, state.score);
let animationTimer = null;
let gainTimer = null;
let inputQueue = [];
let gesture = null;
let lastResult = '';
let lastSaved = false;

document.querySelector('.grid').append(...Array.from({ length: 16 }, () => {
  const cell = document.createElement('div'); cell.className = 'cell'; return cell;
}));

function persist() {
  best = Math.max(best, state.score);
  lastSaved = writeSave(storage, state, previous, best);
  $('save-label').textContent = lastSaved ? '自動セーブ' : '保存できません';
  $('save-status').classList.toggle('error', !lastSaved);
  $('storage-warning').hidden = lastSaved;
}

function placeTile(tile, index) {
  tile.style.setProperty('--col', index % 4);
  tile.style.setProperty('--row', Math.floor(index / 4));
}

function makeTile(value, index) {
  const tile = document.createElement('div');
  const digits = String(value).length;
  tile.className = 'tile' + (digits >= 3 ? ` digits-${digits > 5 ? 'many' : digits}` : '') + (value > 2048 ? ' high-tile' : '');
  tile.dataset.value = value;
  tile.dataset.index = index;
  tile.textContent = value;
  placeTile(tile, index);
  return tile;
}

function drawBoard(spawnedIndex = null, mergedIndices = []) {
  tiles.replaceChildren(...state.board.flatMap((value, index) => {
    if (!value) return [];
    const tile = makeTile(value, index);
    if (index === spawnedIndex) tile.classList.add('spawn');
    if (mergedIndices.includes(index)) tile.classList.add('merge');
    return [tile];
  }));
  const rows = Array.from({ length: 4 }, (_, row) => {
    const p = document.createElement('p');
    p.textContent = `${row + 1}行目：` + state.board.slice(row * 4, row * 4 + 4).map(n => n || '空き').join('、');
    return p;
  });
  $('accessible-board').replaceChildren(...rows);
}

function renderControls() {
  $('score').textContent = state.score.toLocaleString('ja-JP');
  $('best').textContent = best.toLocaleString('ja-JP');
  $('moves').textContent = `${state.moves.toLocaleString('ja-JP')} 手`;
  $('undo-button').disabled = !previous;
  $('result-undo').hidden = !previous;
  const resultType = state.won && !state.keepPlaying ? 'win' : state.over ? 'over' : '';
  $('result').hidden = !resultType;
  board.tabIndex = resultType ? -1 : 0;
  if (resultType) {
    const won = resultType === 'win';
    $('result-kicker').textContent = won ? 'WELL PLAYED' : 'NICE TRY';
    $('result-title').textContent = won ? '2048 達成！' : 'おつかれさま。';
    $('result-description').textContent = won ? 'もう少し先の数字を、目指してみよう。' : `スコア ${state.score.toLocaleString('ja-JP')}。次のひと手を、また。`;
    $('continue-button').hidden = !won;
    $('retry-button').hidden = won;
    if (resultType !== lastResult && !$('new-dialog').open && !$('help-dialog').open) {
      (won ? $('continue-button') : $('retry-button')).focus({ preventScroll: true });
      $('announcement').textContent = won ? '2048達成！ 続けて遊べます。' : `ゲーム終了。スコア ${state.score}。`;
    }
  }
  lastResult = resultType;
}

function finishAnimation(result = null) {
  clearTimeout(animationTimer);
  animationTimer = null;
  drawBoard(result?.spawnedIndex, result?.transitions.filter(t => t.merged).map(t => t.to));
  renderControls();
  while (inputQueue.length && animationTimer === null && !$('new-dialog').open && !$('help-dialog').open) {
    const direction = inputQueue.shift();
    requestMove(direction);
  }
}

function requestMove(direction) {
  if ($('new-dialog').open || $('help-dialog').open) return;
  if (animationTimer !== null) {
    if (inputQueue.length < 8) inputQueue.push(direction);
    return;
  }
  const result = moveGame(state, direction);
  if (!result.changed) return;
  const gain = result.state.score - state.score;
  previous = state;
  state = result.state;
  persist(); // Save the completed turn before animation or any lifecycle event.
  $('score').textContent = state.score.toLocaleString('ja-JP');
  $('best').textContent = best.toLocaleString('ja-JP');
  if (gain) {
    clearTimeout(gainTimer);
    const label = $('score-gain');
    label.classList.remove('pop');
    label.textContent = `+${gain}`;
    void label.offsetWidth;
    label.classList.add('pop');
    gainTimer = setTimeout(() => { label.textContent = ''; }, 650);
  }
  $('announcement').textContent = `${state.moves}手目。スコア ${state.score}。最大 ${Math.max(...state.board)}。`;
  if (reduceMotion.matches) { finishAnimation(result); return; }
  void tiles.offsetWidth; // Commit newly drawn tiles before a queued move animates.
  for (const transition of result.transitions) {
    const tile = tiles.querySelector(`[data-index="${transition.from}"]`);
    if (tile) {
      if (transition.merged) tile.style.zIndex = '2';
      placeTile(tile, transition.to);
    }
  }
  animationTimer = setTimeout(() => finishAnimation(result), 115);
}

function stopMotion() {
  inputQueue = [];
  clearTimeout(animationTimer);
  animationTimer = null;
  clearTimeout(gainTimer);
  $('score-gain').textContent = '';
}

function undo() {
  if (!previous) return;
  stopMotion();
  state = previous;
  previous = null;
  persist();
  drawBoard();
  renderControls();
  $('announcement').textContent = '1手戻しました。';
  board.focus({ preventScroll: true });
}

function openNewGame() {
  stopMotion();
  drawBoard();
  renderControls();
  $('new-dialog').showModal();
  $('cancel-new').focus();
}

$('new-button').addEventListener('click', openNewGame);
$('retry-button').addEventListener('click', openNewGame);
$('cancel-new').addEventListener('click', () => $('new-dialog').close());
$('confirm-new').addEventListener('click', () => {
  stopMotion();
  state = createGame();
  previous = null;
  persist();
  $('new-dialog').close();
  drawBoard();
  renderControls();
  $('announcement').textContent = '新しいゲームを始めました。';
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
$('help-button').addEventListener('click', () => {
  stopMotion();
  drawBoard();
  renderControls();
  $('help-dialog').showModal();
});
$('close-help').addEventListener('click', () => $('help-dialog').close());
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}

board.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary) { gesture = null; return; }
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
  board.setPointerCapture(event.pointerId);
});
board.addEventListener('pointerup', (event) => {
  if (!gesture || event.pointerId !== gesture.id) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  gesture = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
  requestMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
});
board.addEventListener('pointercancel', () => { gesture = null; });
board.addEventListener('lostpointercapture', () => { gesture = null; });
board.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
  if ($('new-dialog').open || $('help-dialog').open) return;
  const direction = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' }[event.key];
  if (direction) { event.preventDefault(); requestMove(direction); }
});
for (const button of document.querySelectorAll('[data-direction]')) {
  button.addEventListener('click', () => requestMove(button.dataset.direction));
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { stopMotion(); persist(); drawBoard(); renderControls(); }
});
window.addEventListener('pagehide', persist);

persist();
drawBoard();
renderControls();
if (saved.status === 'unavailable' && lastSaved) $('announcement').textContent = '保存データを読み込めなかったため、新しいゲームを始めました。';

if ('serviceWorker' in navigator) {
  const offlineFailed = () => {
    $('offline-help').textContent = 'オフラインの準備ができませんでした。通信できる状態でもう一度開いてください。';
  };
  $('offline-help').textContent = 'オフラインで遊ぶ準備をしています。';
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((registration) => {
    const watchInstalling = () => {
      const worker = registration.installing;
      if (!worker) return;
      const checkState = () => {
        if (worker.state === 'redundant' && !registration.active) offlineFailed();
      };
      worker.addEventListener('statechange', checkState);
      checkState();
    };
    registration.addEventListener('updatefound', watchInstalling);
    watchInstalling();
    return navigator.serviceWorker.ready;
  }).then(() => {
    $('offline-help').textContent = 'オフラインでも遊べる準備ができています。';
  }).catch(offlineFailed);
} else {
  $('offline-help').textContent = 'このブラウザではオフライン起動を利用できません。';
}
