import { cheb, sortPositions } from "./board";
import type { BoardState, GameConfig, Vec2 } from "./types";

export class SpecialSquareGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecialSquareGenerationError";
  }
}

function randomFromSeed(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const rng = randomFromSeed(seed);
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

export function specialSquareCandidates(config: GameConfig): Vec2[] {
  const candidates: Vec2[] = [];
  const minCol = config.cols >= 8 ? 3 : 1;
  const maxColExclusive = config.cols >= 8 ? config.cols - 3 : config.cols - 1;
  for (let row = 1; row < config.rows - 1; row += 1) {
    for (let col = minCol; col < maxColExclusive; col += 1) {
      candidates.push([row, col]);
    }
  }
  return candidates;
}

export function generateSpecialSquares(config: GameConfig, count = config.specialCount, seed = Date.now()): Vec2[] {
  if (count < 0) {
    throw new SpecialSquareGenerationError("Special-square count cannot be negative");
  }
  const chosen: Vec2[] = [];
  for (const pos of shuffle(specialSquareCandidates(config), seed)) {
    if (chosen.every((other) => cheb(pos, other) >= 3)) {
      chosen.push(pos);
      if (chosen.length === count) {
        return sortPositions(chosen);
      }
    }
  }
  throw new SpecialSquareGenerationError(`Could not place ${count} Special Squares with spacing >= 3 on ${config.rows}x${config.cols}`);
}

export function assignGeneratedSpecialSquares(board: BoardState, seed = Date.now(), count = board.config.specialCount): void {
  const generated = generateSpecialSquares(board.config, count, seed);
  board.specialSquares = generated;
}
