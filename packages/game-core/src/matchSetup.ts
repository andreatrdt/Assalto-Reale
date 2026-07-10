import { createBoard, getPiece } from "./board.js";
import { PLACEMENT_SCHEDULE } from "./config.js";
import { canPlacePiece, nextPieceTypeFor, placePiece } from "./placement.js";
import { assignGeneratedSpecialSquares } from "./specialSquares.js";
import { updateControl } from "./territory.js";
import type { BoardState, PieceType, Player, Vec2 } from "./types.js";
import type { PendingPlacement, PiecesLeft } from "./matchTypes.js";

export function createInitialPiecesLeft(): PiecesLeft {
  return {
    Black: { King: 1, AttackPawn: 4, DefensePawn: 4, ConquestPawn: 4 },
    White: { King: 1, AttackPawn: 4, DefensePawn: 4, ConquestPawn: 4 },
  };
}

export function createEmptyPiecesLeft(): PiecesLeft {
  return {
    Black: { King: 0, AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0 },
    White: { King: 0, AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0 },
  };
}

export function clonePiecesLeft(piecesLeft: PiecesLeft): PiecesLeft {
  return {
    Black: { ...piecesLeft.Black },
    White: { ...piecesLeft.White },
  };
}

export function createBaseBoard(transformEnabled: boolean, seed: number): BoardState {
  const board = createBoard({ transformEnabled });
  assignGeneratedSpecialSquares(board, seed);
  updateControl(board);
  return board;
}

function buildPlacementQueue(): PendingPlacement[] {
  const remaining = createInitialPiecesLeft();
  const queue: PendingPlacement[] = [];
  for (const step of PLACEMENT_SCHEDULE) {
    for (let index = 0; index < step.count; index += 1) {
      const pieceType = nextPieceTypeFor(step.player, remaining);
      if (!pieceType) {
        throw new Error(`Placement queue overfilled ${step.player}`);
      }
      queue.push({ player: step.player, pieceType });
      remaining[step.player][pieceType] -= 1;
    }
  }
  return queue;
}

export const PLACEMENT_QUEUE = buildPlacementQueue();
export const TOTAL_PLACEMENTS = PLACEMENT_SCHEDULE.reduce((sum, step) => sum + step.count, 0);

function findKing(board: BoardState, player: Player): Vec2 | null {
  for (let row = 0; row < board.config.rows; row += 1) {
    for (let col = 0; col < board.config.cols; col += 1) {
      const piece = board.grid[row][col];
      if (piece?.player === player && piece.type === "King") {
        return [row, col];
      }
    }
  }
  return null;
}

export function chooseQuickPlacementSquare(board: BoardState, player: Player, pieceType: PieceType): Vec2 {
  const kingPos = findKing(board, player);
  const center = Math.floor(board.config.rows / 2);
  const anchor: Vec2 =
    pieceType === "King"
      ? [center, player === "Black" ? 2 : board.config.cols - 3]
      : pieceType === "AttackPawn"
        ? [center, player === "Black" ? 0 : board.config.cols - 1]
        : pieceType === "DefensePawn" && kingPos
          ? kingPos
          : pieceType === "ConquestPawn"
            ? [center, player === "Black" ? 2 : board.config.cols - 3]
            : [center, Math.floor(board.config.cols / 2)];

  let best: Vec2 | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let row = 0; row < board.config.rows; row += 1) {
    for (let col = 0; col < board.config.cols; col += 1) {
      const pos: Vec2 = [row, col];
      if (!canPlacePiece(board, pos, player, pieceType).ok) {
        continue;
      }
      let score = -2 * (Math.abs(row - anchor[0]) + Math.abs(col - anchor[1]));
      if (pieceType === "DefensePawn" && kingPos) {
        const distance = Math.max(Math.abs(row - kingPos[0]), Math.abs(col - kingPos[1]));
        if (distance === 1) score += 100;
        if (distance === 2) score += 30;
      }
      if (pieceType === "ConquestPawn") {
        const distance = Math.min(
          ...board.specialSquares.map((special) => Math.max(Math.abs(row - special[0]), Math.abs(col - special[1]))),
        );
        score += 60 / Math.max(1, distance);
      }
      score += player === "White" ? col * 0.01 : -col * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = pos;
      }
    }
  }
  if (!best) {
    throw new Error(`No legal quick placement for ${player} ${pieceType}`);
  }
  return best;
}

export function createQuickBalancedBoard(transformEnabled: boolean, seed: number): BoardState {
  const board = createBaseBoard(transformEnabled, seed);
  for (const item of PLACEMENT_QUEUE) {
    const position = chooseQuickPlacementSquare(board, item.player, item.pieceType);
    placePiece(board, position, item.player, item.pieceType);
  }
  updateControl(board);
  return board;
}

export function countPlacedPieces(board: BoardState): number {
  let count = 0;
  for (let row = 0; row < board.config.rows; row += 1) {
    for (let col = 0; col < board.config.cols; col += 1) {
      if (getPiece(board, [row, col])) count += 1;
    }
  }
  return count;
}
