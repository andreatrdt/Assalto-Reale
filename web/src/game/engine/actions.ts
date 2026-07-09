import { PAWN_TYPES } from "./config";
import { cheb, cloneBoard, getPiece, inBounds, samePos, setPiece } from "./board";
import { adjacentDefendersForKing, getDefendedKingPreviewFromPositions, intermediateClear } from "./defendedKing";
import { evaluateVictory } from "./victory";
import { getSpecialControl, updateControl } from "./territory";
import type { Action, BoardState, Piece, TransitionEvent, TransitionResult, Vec2 } from "./types";

function invalid(start: Vec2, end: Vec2, player: Action["player"], error: string): Action {
  return { kind: "invalid", player, start, end, cost: 0, capture: false, endsTurn: false, error };
}

export function isAllowedCaptureType(mover: Piece, target: Piece): boolean {
  if (mover.player === target.player) {
    return false;
  }
  if (mover.type === "AttackPawn") {
    return target.type === "DefensePawn" || target.type === "King";
  }
  if (mover.type === "DefensePawn") {
    return target.type === "ConquestPawn";
  }
  if (mover.type === "ConquestPawn") {
    return target.type === "AttackPawn";
  }
  if (mover.type === "King") {
    return PAWN_TYPES.includes(target.type as (typeof PAWN_TYPES)[number]);
  }
  return false;
}

function captureGeometry(
  board: BoardState,
  mover: Piece,
  start: Vec2,
  end: Vec2,
  target: Piece,
  movesThisTurn: number,
): [boolean, number, string] {
  const dr = end[0] - start[0];
  const dc = end[1] - start[1];
  const adr = Math.abs(dr);
  const adc = Math.abs(dc);
  const dist = Math.max(adr, adc);

  if (!isAllowedCaptureType(mover, target)) {
    return [false, 0, "piece type cannot capture target type"];
  }
  if (mover.type === "AttackPawn") {
    if (!((adr === 1 || adr === 2) && adc === 0) && !((adc === 1 || adc === 2) && adr === 0)) {
      return [false, 0, "Attack Pawn captures orthogonally only"];
    }
    if (dist === 2) {
      if (movesThisTurn !== 0) {
        return [false, 0, "two-square capture must be the first action"];
      }
      if (!intermediateClear(board, start, end)) {
        return [false, 0, "intermediate square is blocked"];
      }
    }
    return [true, dist, ""];
  }
  if (mover.type === "DefensePawn") {
    if (adr !== adc || ![1, 2].includes(dist)) {
      return [false, 0, "Defense Pawn captures diagonally only"];
    }
    if (dist === 2) {
      if (movesThisTurn !== 0) {
        return [false, 0, "two-square capture must be the first action"];
      }
      if (!intermediateClear(board, start, end)) {
        return [false, 0, "intermediate square is blocked"];
      }
    }
    return [true, dist, ""];
  }
  if (mover.type === "ConquestPawn") {
    return dist === 1 ? [true, 1, ""] : [false, 0, "Conquest Pawn captures adjacent Attack Pawns only"];
  }
  if (mover.type === "King") {
    return dist === 1 ? [true, 1, ""] : [false, 0, "King captures adjacent pawns only"];
  }
  return [false, 0, "unsupported piece type"];
}

export function buildAction(
  board: BoardState,
  start: Vec2,
  end: Vec2,
  options: { movesThisTurn?: number; kingMoved?: boolean; selectedDefender?: Vec2 | null } = {},
): Action {
  const movesThisTurn = options.movesThisTurn ?? 0;
  const kingMoved = options.kingMoved ?? false;
  if (movesThisTurn >= 2) {
    return invalid(start, end, "", "no action points remain");
  }
  if (!inBounds(board, start) || !inBounds(board, end)) {
    return invalid(start, end, "", "outside board");
  }
  const mover = getPiece(board, start);
  if (!mover) {
    return invalid(start, end, "", "no piece at start");
  }
  if (mover.type === "King" && kingMoved) {
    return invalid(start, end, mover.player, "King has already acted this turn");
  }
  if (samePos(start, end)) {
    return invalid(start, end, mover.player, "start equals destination");
  }
  const target = getPiece(board, end);
  const dist = cheb(start, end);
  if (!target) {
    if (dist !== 1) {
      return invalid(start, end, mover.player, "normal movement is one adjacent square");
    }
    return { kind: "move", player: mover.player, start, end, cost: 1, capture: false, endsTurn: movesThisTurn + 1 >= 2 };
  }
  if (target.player === mover.player) {
    return invalid(start, end, mover.player, "destination has a friendly piece");
  }
  const [ok, cost, reason] = captureGeometry(board, mover, start, end, target, movesThisTurn);
  if (!ok) {
    return invalid(start, end, mover.player, reason);
  }
  if (movesThisTurn + cost > 2) {
    return invalid(start, end, mover.player, "not enough action points");
  }
  let defendedKing = null;
  let capturedPieceType = target.type;
  let capturedPlayer = target.player;
  let endsTurn = movesThisTurn + cost >= 2 || target.type === "King";
  if (mover.type === "AttackPawn" && target.type === "King") {
    defendedKing = getDefendedKingPreviewFromPositions(board, start, end, movesThisTurn);
    if (defendedKing) {
      capturedPieceType = "DefensePawn";
      capturedPlayer = target.player;
      endsTurn = true;
      if (
        options.selectedDefender &&
        !adjacentDefendersForKing(board, end, target.player).some((pos) => samePos(pos, options.selectedDefender!))
      ) {
        return invalid(start, end, mover.player, "selected defender is not eligible");
      }
    }
  }
  return {
    kind: "capture",
    player: mover.player,
    start,
    end,
    cost,
    capture: true,
    capturedPlayer,
    capturedPieceType,
    targetPieceType: target.type,
    defendedKing,
    selectedDefender: options.selectedDefender ?? null,
    endsTurn,
  };
}

export function applyAction(
  source: BoardState,
  action: Action,
  options: { movesThisTurn?: number; kingMoved?: boolean; validate?: boolean } = {},
): { board: BoardState; result: TransitionResult } {
  const board = cloneBoard(source);
  if (action.kind === "pass") {
    return {
      board,
      result: {
        action,
        events: [{ kind: "pass", data: { player: action.player } }],
        victory: null,
        specialControl: getSpecialControl(board),
        endsTurn: true,
        nextMovesThisTurn: 0,
        nextKingMoved: false,
      },
    };
  }
  if (!action.start || !action.end) {
    return {
      board,
      result: {
        action,
        events: [],
        victory: null,
        specialControl: null,
        error: "action is missing coordinates",
        endsTurn: false,
        nextMovesThisTurn: 0,
        nextKingMoved: false,
      },
    };
  }
  const movesThisTurn = options.movesThisTurn ?? 0;
  const checked =
    options.validate === false
      ? action
      : buildAction(board, action.start, action.end, {
          movesThisTurn,
          kingMoved: options.kingMoved ?? false,
          selectedDefender: action.selectedDefender,
        });
  if (checked.error) {
    return {
      board,
      result: {
        action: checked,
        events: [],
        victory: null,
        specialControl: null,
        error: checked.error,
        endsTurn: false,
        nextMovesThisTurn: 0,
        nextKingMoved: false,
      },
    };
  }
  const start = checked.start!;
  const end = checked.end!;
  const mover = getPiece(board, start);
  const target = getPiece(board, end);
  if (!mover) {
    return {
      board,
      result: {
        action: checked,
        events: [],
        victory: null,
        specialControl: null,
        error: "no piece at start",
        endsTurn: false,
        nextMovesThisTurn: 0,
        nextKingMoved: false,
      },
    };
  }

  const events: TransitionEvent[] = [];
  let victory = null;
  let landing = end;
  if (checked.defendedKing) {
    const defenders = adjacentDefendersForKing(board, end, target?.player ?? "");
    const defenderPos = checked.selectedDefender ?? defenders[0];
    const defenderPiece = getPiece(board, defenderPos);
    if (!defenderPiece || defenderPiece.type !== "DefensePawn") {
      return {
        board,
        result: {
          action: checked,
          events: [],
          victory: null,
          specialControl: null,
          error: "defender disappeared before resolution",
          endsTurn: false,
          nextMovesThisTurn: 0,
          nextKingMoved: false,
        },
      };
    }
    setPiece(board, start, null);
    setPiece(board, defenderPos, null);
    landing = checked.defendedKing.landingPosition;
    setPiece(board, landing, mover);
    board.capturedPieces[defenderPiece.player].DefensePawn += 1;
    events.push(
      { kind: "defended_king", data: { king: end, defender: defenderPos, landing } },
      { kind: "capture", data: { captured_player: defenderPiece.player, captured_piece_type: "DefensePawn", at: defenderPos } },
      { kind: "bounce", data: { path: checked.defendedKing.bouncePath, landing } },
    );
  } else {
    setPiece(board, start, null);
    setPiece(board, end, mover);
    if (target) {
      board.capturedPieces[target.player][target.type] += 1;
      events.push({ kind: "capture", data: { captured_player: target.player, captured_piece_type: target.type, at: end } });
      if (target.type === "King") {
        victory = { winner: mover.player, reason: "king_capture" as const, loser: target.player };
      }
    } else {
      events.push({ kind: "move", data: { from: start, to: end } });
    }
  }
  updateControl(board);
  if (board.transformSquares.some((pos) => samePos(pos, landing)) && PAWN_TYPES.includes(mover.type as (typeof PAWN_TYPES)[number])) {
    events.push({ kind: "transform_available", data: { player: mover.player, piece_type: mover.type, at: landing } });
  }
  let nextMoves = movesThisTurn + checked.cost;
  let nextKingMoved = (options.kingMoved ?? false) || mover.type === "King";
  const endsTurn = checked.endsTurn || nextMoves >= 2;
  if (endsTurn) {
    nextMoves = 0;
    nextKingMoved = false;
  }
  victory ??= evaluateVictory(board, { lastActor: mover.player });
  return {
    board,
    result: {
      action: checked,
      events,
      victory,
      specialControl: getSpecialControl(board),
      endsTurn,
      nextMovesThisTurn: nextMoves,
      nextKingMoved,
    },
  };
}
