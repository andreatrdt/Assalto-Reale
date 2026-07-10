// Pure turn/move helpers extracted from the store: target enumeration, message
// formatting, defender lookup, transform-event detection and half-turn advance.
// No React, no store access — they take board/state slices and return values.
import {
  adjacentDefendersForKing,
  buildAction,
  ensureTransformSquare,
  getPiece,
  PAWN_TYPES,
  refreshTerritoryClaim,
  type Action,
  type BoardState,
  type PawnType,
  type PieceType,
  type Player,
  type TransitionResult,
  type Vec2,
} from "../engine";
import type { GameState, PendingTransform } from "../state/storeTypes";

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

export function switchPlayer(player: Player): Player {
  return player === "Black" ? "White" : "Black";
}

export function squareName(pos: Vec2): string {
  return `${String.fromCharCode("A".charCodeAt(0) + pos[1])}${12 - pos[0]}`;
}

export function defenderPositions(board: BoardState, action: Action): Vec2[] {
  if (!action.end) return [];
  const king = getPiece(board, action.end);
  return king ? adjacentDefendersForKing(board, action.end, king.player) : [];
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

export function transformEvent(result: TransitionResult): PendingTransform | null {
  const event = result.events.find((item) => item.kind === "transform_available");
  if (!event) return null;
  return {
    owner: event.data.player as Player,
    pos: event.data.at as Vec2,
    player: event.data.player as Player,
    pieceType: event.data.piece_type as PawnType,
    forceTurnSwitch: false,
  };
}

export function advanceHalfTurn(
  board: BoardState,
  state: Pick<GameState, "turnCounter" | "currentPlayer">,
): {
  currentPlayer: Player;
  turnCounter: number;
  victory: TransitionResult["victory"];
} {
  const turnCounter = state.turnCounter + 1;
  ensureTransformSquare(board, turnCounter, turnCounter);
  const victory = refreshTerritoryClaim(board, turnCounter);
  return {
    currentPlayer: switchPlayer(state.currentPlayer),
    turnCounter,
    victory,
  };
}
