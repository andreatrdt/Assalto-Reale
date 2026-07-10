import { PAWN_TYPES } from "./config";
import { cheb, cloneBoard, getPiece, hasPos, inBounds, setPiece, sortPositions } from "./board";
import { choice, mulberry32 } from "./random";
import { evaluateVictory } from "./victory";
import { getSpecialControl, updateControl } from "./territory";
import type { BoardState, PawnType, Piece, TransitionEvent, TransitionResult, Vec2 } from "./types";

function pawnEntries(board: BoardState): Array<{ pos: Vec2; piece: Piece }> {
  const entries: Array<{ pos: Vec2; piece: Piece }> = [];
  for (let row = 0; row < board.config.rows; row += 1) {
    for (let col = 0; col < board.config.cols; col += 1) {
      const piece = board.grid[row][col];
      if (piece && PAWN_TYPES.includes(piece.type as PawnType)) {
        entries.push({ pos: [row, col], piece });
      }
    }
  }
  return entries;
}

export function generateTransformSquare(board: BoardState, seed?: number): boolean {
  board.transformSquares = [];
  const pawns = pawnEntries(board);
  const candidates: Vec2[] = [];

  for (let row = 1; row < board.config.rows - 1; row += 1) {
    for (let col = 1; col < board.config.cols - 1; col += 1) {
      const pos: Vec2 = [row, col];
      if (getPiece(board, pos) || hasPos(board.specialSquares, pos)) {
        continue;
      }
      const distances = pawns
        .map((entry) => ({ distance: cheb(pos, entry.pos), player: entry.piece.player }))
        .sort((a, b) => a.distance - b.distance || a.player.localeCompare(b.player));
      if (distances.length < 2) {
        continue;
      }
      if (distances[0].distance === distances[1].distance && distances[0].player !== distances[1].player) {
        candidates.push(pos);
      }
    }
  }

  const sorted = sortPositions(candidates);
  if (sorted.length === 0) {
    return false;
  }
  // Seeded selection uses the shared Mulberry32 choice so the Python and
  // TypeScript engines pick the same square for the same seed. The no-seed
  // path (real matches that do not pin a seed) stays deterministic on the
  // first sorted candidate; it is engine-local and not a parity contract.
  const chosen = seed === undefined ? sorted[0] : (choice(sorted, mulberry32(seed)) as Vec2);
  board.transformSquares = [chosen];
  return true;
}

export function ensureTransformSquare(board: BoardState, turnCounter: number, seed?: number): boolean {
  if (!board.config.transformEnabled || turnCounter < board.config.transformRound * 2 || board.transformSquares.length > 0) {
    return false;
  }
  return generateTransformSquare(board, seed);
}

export function transformPiece(
  source: BoardState,
  pos: Vec2,
  newType: PawnType,
  seed?: number,
): { board: BoardState; result: TransitionResult } {
  const board = cloneBoard(source);
  const action = { kind: "transform" as const, player: "" as const, start: pos, end: pos, cost: 0, capture: false, endsTurn: true };
  if (!inBounds(board, pos)) {
    return {
      board,
      result: {
        action,
        events: [],
        victory: null,
        specialControl: null,
        error: "outside board",
        endsTurn: false,
        nextMovesThisTurn: 0,
        nextKingMoved: false,
      },
    };
  }

  const piece = getPiece(board, pos);
  if (!piece) {
    return {
      board,
      result: {
        action,
        events: [],
        victory: null,
        specialControl: null,
        error: "no piece to transform",
        endsTurn: false,
        nextMovesThisTurn: 0,
        nextKingMoved: false,
      },
    };
  }

  const checked = { ...action, player: piece.player };
  if (!hasPos(board.transformSquares, pos)) {
    return {
      board,
      result: {
        action: checked,
        events: [],
        victory: null,
        specialControl: null,
        error: "piece is not on the Transform Square",
        endsTurn: false,
        nextMovesThisTurn: 0,
        nextKingMoved: false,
      },
    };
  }
  if (piece.type === "King") {
    return {
      board,
      result: {
        action: checked,
        events: [],
        victory: null,
        specialControl: null,
        error: "King cannot transform",
        endsTurn: false,
        nextMovesThisTurn: 0,
        nextKingMoved: false,
      },
    };
  }
  if (!PAWN_TYPES.includes(newType)) {
    return {
      board,
      result: {
        action: checked,
        events: [],
        victory: null,
        specialControl: null,
        error: "invalid transform target",
        endsTurn: false,
        nextMovesThisTurn: 0,
        nextKingMoved: false,
      },
    };
  }
  if (newType === piece.type) {
    return {
      board,
      result: {
        action: checked,
        events: [],
        victory: null,
        specialControl: null,
        error: "piece must transform into a different pawn type",
        endsTurn: false,
        nextMovesThisTurn: 0,
        nextKingMoved: false,
      },
    };
  }

  const oldType = piece.type;
  const oldSquare = board.transformSquares[0] ?? null;
  setPiece(board, pos, { player: piece.player, type: newType });
  updateControl(board);
  const relocated = generateTransformSquare(board, seed);
  const newSquare = board.transformSquares[0] ?? null;
  updateControl(board);

  const events: TransitionEvent[] = [
    {
      kind: "transform",
      data: {
        player: piece.player,
        at: pos,
        old_type: oldType,
        new_type: newType,
        old_square: oldSquare,
        new_square: newSquare,
        relocated,
      },
    },
  ];

  return {
    board,
    result: {
      action: checked,
      events,
      victory: evaluateVictory(board, { lastActor: piece.player }),
      specialControl: getSpecialControl(board),
      endsTurn: true,
      nextMovesThisTurn: 0,
      nextKingMoved: false,
    },
  };
}
