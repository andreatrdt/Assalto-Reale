// Browser compatibility wrapper around the pure setup primitives owned by
// `packages/game-core`. Only default seed generation remains browser-facing.
import {
  clonePiecesLeft,
  createBaseBoard as createCoreBaseBoard,
  createEmptyPiecesLeft,
  createInitialPiecesLeft,
  PLACEMENT_QUEUE,
  TOTAL_PLACEMENTS,
  type BoardState,
} from "../engine";

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export { clonePiecesLeft, createEmptyPiecesLeft, createInitialPiecesLeft, PLACEMENT_QUEUE, TOTAL_PLACEMENTS };

export function createBaseBoard(transformEnabled: boolean, seed = randomSeed()): BoardState {
  return createCoreBaseBoard(transformEnabled, seed);
}
