import { cheb, sortPositions } from "./board";
import { mulberry32, shuffle } from "./random";
import type { BoardState, GameConfig, Vec2 } from "./types";

export class SpecialSquareGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecialSquareGenerationError";
  }
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
  for (const pos of shuffle(specialSquareCandidates(config), mulberry32(seed))) {
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
