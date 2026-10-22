/** Pure 2048 rules. This module has no browser or storage dependencies. */
export const SIZE = 4;

const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);

function validTile(value) {
  return value === 0 || (
    Number.isSafeInteger(value) && value >= 2 && value === 2 ** Math.round(Math.log2(value))
  );
}

function validBoard(board) {
  return Array.isArray(board) && board.length === SIZE * SIZE &&
    Array.from(board).every(validTile);
}

/** Whether at least one slide or merge is available. */
export function canMove(board) {
  if (!validBoard(board)) return false;
  if (board.some(value => value === 0)) return board.some(value => value !== 0);
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const index = row * SIZE + col;
      if (col < SIZE - 1 && board[index] === board[index + 1]) return true;
      if (row < SIZE - 1 && board[index] === board[index + SIZE]) return true;
    }
  }
  return false;
}

/**
 * Validate persisted input and return a clean, independent state.
 * Outcome flags are recomputed so stale flags cannot strand a valid game.
 */
export function normalizeState(input) {
  if (input === null || typeof input !== 'object' || !validBoard(input.board) ||
      !input.board.some(value => value !== 0) ||
      !Number.isSafeInteger(input.score) || input.score < 0 ||
      !Number.isSafeInteger(input.moves) || input.moves < 0 ||
      typeof input.won !== 'boolean' || typeof input.keepPlaying !== 'boolean' ||
      typeof input.over !== 'boolean') return null;

  const board = input.board.slice();
  const won = board.some(value => value >= 2048);
  return {
    board,
    score: input.score,
    moves: input.moves,
    won,
    keepPlaying: won && input.keepPlaying,
    over: !canMove(board),
  };
}

export function isValidState(input) {
  return normalizeState(input) !== null;
}

function sample(rng) {
  const value = rng();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('The random source must return a number in [0, 1).');
  }
  return value;
}

function spawn(board, rng) {
  const empty = [];
  board.forEach((value, index) => {
    if (value === 0) empty.push(index);
  });
  if (empty.length === 0) return null;
  const index = empty[Math.floor(sample(rng) * empty.length)];
  board[index] = sample(rng) < 0.9 ? 2 : 4;
  return index;
}

export function createGame(rng = Math.random) {
  const board = Array(SIZE * SIZE).fill(0);
  spawn(board, rng);
  spawn(board, rng);
  return { board, score: 0, moves: 0, won: false, keepPlaying: false, over: false };
}

// Each line is ordered from the edge toward which the tiles move.
function lineIndices(direction, line) {
  return Array.from({ length: SIZE }, (_, step) => {
    switch (direction) {
      case 'left': return line * SIZE + step;
      case 'right': return line * SIZE + SIZE - 1 - step;
      case 'up': return step * SIZE + line;
      case 'down': return (SIZE - 1 - step) * SIZE + line;
      default: return -1;
    }
  });
}

/**
 * Attempt one move without mutating the supplied state.
 * A successful move spawns exactly one tile. No-op moves consume no randomness.
 * Transitions describe original tiles before the new tile is spawned.
 */
export function moveGame(state, direction, rng = Math.random) {
  const unchanged = () => ({ state, changed: false, transitions: [], spawnedIndex: null });
  if (!DIRECTIONS.has(direction)) return unchanged();
  const normalized = normalizeState(state);
  if (!normalized || normalized.over || (normalized.won && !normalized.keepPlaying)) {
    return unchanged();
  }

  const board = Array(SIZE * SIZE).fill(0);
  const transitions = [];
  let gained = 0;

  for (let line = 0; line < SIZE; line += 1) {
    const indices = lineIndices(direction, line);
    const tiles = indices.filter(index => state.board[index] !== 0)
      .map(from => ({ from, value: state.board[from] }));
    let destination = 0;
    for (let source = 0; source < tiles.length; source += 1) {
      const first = tiles[source];
      const second = tiles[source + 1];
      const to = indices[destination];
      if (second && first.value === second.value) {
        const value = first.value * 2;
        board[to] = value;
        gained += value;
        transitions.push({ ...first, to, merged: true }, { ...second, to, merged: true });
        source += 1;
      } else {
        board[to] = first.value;
        transitions.push({ ...first, to, merged: false });
      }
      destination += 1;
    }
  }

  if (board.every((value, index) => value === state.board[index])) return unchanged();

  // Refuse arithmetic outside the exact integer range instead of corrupting a save.
  if (!validBoard(board) || !Number.isSafeInteger(state.score + gained) ||
      !Number.isSafeInteger(state.moves + 1)) return unchanged();

  const spawnedIndex = spawn(board, rng);
  const won = board.some(value => value >= 2048);
  return {
    state: {
      board,
      score: state.score + gained,
      moves: state.moves + 1,
      won,
      keepPlaying: normalized.keepPlaying,
      over: !canMove(board),
    },
    changed: true,
    transitions,
    spawnedIndex,
  };
}
