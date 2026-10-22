import { normalizeState } from './engine.js';

export const SAVE_KEY = 'pocket-2048.save.v1';

export function readSave(storage) {
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return { state: null, previous: null, best: 0, status: 'new' };
    const saved = JSON.parse(raw);
    if (saved.version !== 1) throw new Error('Unknown save format');
    const state = normalizeState(saved.state);
    if (!state) throw new Error('Invalid save');
    const previous = normalizeState(saved.previous);
    const best = Number.isSafeInteger(saved.best) && saved.best >= 0 ? saved.best : 0;
    return { state, previous, best: Math.max(best, state.score, previous?.score || 0), status: 'loaded' };
  } catch {
    return { state: null, previous: null, best: 0, status: 'unavailable' };
  }
}

export function writeSave(storage, state, previous, best) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, state, previous, best, savedAt: Date.now() }));
    return true;
  } catch { return false; }
}
