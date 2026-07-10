// UI-facing helpers only. Canonical placement, turn progression, Defended King,
// Transform, territory and victory transitions live in `packages/game-core`.
import { buildAction, getPiece, PAWN_TYPES, type Action, type BoardState, type PawnType, type PieceType, type Vec2 } from "../engine";

export function describePiece(pieceType: PieceType): string {
  return pieceType.replace("Pawn", " Pawn");
}

export function actionTargets(board: BoardState, pos: Vec2, movesThisTurn: number, kingMoved: boolean): Vec2[] {
  const targets: Vec2[] = [];
  for (let dr = -2; dr <= 2; dr += 1) {
    for (let dc = -2; dc <= 2; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const end: Vec2 = [pos[0] + dr, pos[1] + dc];
      const action = buildAction(board, pos, end, { movesThisTurn, kingMoved });
      if (!action.error) {
        targets.push(end);
      }
    }
  }
  return targets;
}

export function squareName(pos: Vec2): string {
  return `${String.fromCharCode("A".charCodeAt(0) + pos[1])}${12 - pos[0]}`;
}

export function transformOptions(pieceType: PawnType): PawnType[] {
  return PAWN_TYPES.filter((item) => item !== pieceType);
}

export function describeAction(action: Action, end: Vec2): string {
  if (action.defendedKing) {
    return `${action.player} attacked a defended King; Attack Pawn bounced to ${squareName(action.defendedKing.landingPosition)}.`;
  }
  if (action.kind === "capture") {
    return `${action.player} captured ${describePiece(action.capturedPieceType ?? "King")} on ${squareName(end)}.`;
  }
  return `${action.player} moved to ${squareName(end)}.`;
}

export function selectedPieceLabel(board: BoardState, pos: Vec2): string | null {
  const piece = getPiece(board, pos);
  return piece ? `${piece.player} ${describePiece(piece.type)}` : null;
}
