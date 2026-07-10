import { PIECE_ORDER } from "./config.js";
import { cheb, getPiece, hasPos, inBounds, setPiece, createPiece } from "./board.js";
import type { BoardState, PieceType, PlacementResult, Player, Vec2 } from "./types.js";

export function nextPieceTypeFor(player: Player, piecesLeft: Record<Player, Record<PieceType, number>>): PieceType | null {
  for (const pieceType of PIECE_ORDER) {
    if (piecesLeft[player][pieceType] > 0) {
      return pieceType;
    }
  }
  return null;
}

export function canPlacePiece(board: BoardState, pos: Vec2, player: Player, pieceType: PieceType): PlacementResult {
  if (!inBounds(board, pos)) {
    return { ok: false, reason: "outside board" };
  }
  const [, col] = pos;
  if (getPiece(board, pos)) {
    return { ok: false, reason: "occupied square" };
  }
  if (hasPos(board.specialSquares, pos)) {
    return { ok: false, reason: "Special Square" };
  }
  if (hasPos(board.transformSquares, pos)) {
    return { ok: false, reason: "Transform Square" };
  }
  if (pieceType === "King") {
    if (player === "Black" && col >= Math.floor(board.config.cols / 2)) {
      return { ok: false, reason: "Black King must be in the left half" };
    }
    if (player === "White" && col < Math.floor(board.config.cols / 2)) {
      return { ok: false, reason: "White King must be in the right half" };
    }
  } else if (pieceType === "AttackPawn") {
    if (player === "Black" && col >= 2) {
      return { ok: false, reason: "Black Attack Pawns must be in the first two columns" };
    }
    if (player === "White" && col < board.config.cols - 2) {
      return { ok: false, reason: "White Attack Pawns must be in the final two columns" };
    }
  } else if (pieceType === "ConquestPawn") {
    if (board.specialSquares.some((special) => cheb(pos, special) < 3)) {
      return { ok: false, reason: "Conquest Pawn must be at least three squares from every Special Square" };
    }
  }
  return { ok: true };
}

export function placePiece(board: BoardState, pos: Vec2, player: Player, pieceType: PieceType): PlacementResult {
  const result = canPlacePiece(board, pos, player, pieceType);
  if (!result.ok) {
    return result;
  }
  setPiece(board, pos, createPiece(pieceType, player));
  return result;
}
