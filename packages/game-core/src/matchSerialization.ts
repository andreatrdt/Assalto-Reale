import { fromPythonSnapshot, toPythonSnapshot } from "./serialization.js";
import { cloneMatchState } from "./match.js";
import { clonePiecesLeft, PLACEMENT_QUEUE } from "./matchSetup.js";
import type { MatchSnapshot, MatchState, PendingDefendedKing, PendingPlacement, PendingTransform } from "./matchTypes.js";
import type { Action, DefendedKingPreview, PawnType, PieceType, Player, Vec2, VictoryResult } from "./types.js";

const PLAYERS = new Set<Player>(["Black", "White"]);
const PIECE_TYPES = new Set<PieceType>(["King", "AttackPawn", "DefensePawn", "ConquestPawn"]);
const PAWN_TYPES = new Set<PawnType>(["AttackPawn", "DefensePawn", "ConquestPawn"]);
const PHASES = new Set<MatchState["phase"]>(["placement", "playing", "defenderSelection", "transformSelection", "gameOver"]);

function normalizeLegacyPreview(preview: DefendedKingPreview): DefendedKingPreview {
  if (Array.isArray(preview.routes)) return preview;
  return {
    ...preview,
    routes: [
      {
        id: "primary",
        path: preview.bouncePath,
        jumpedSquares: [],
        turnSquares: [],
        landingPosition: preview.landingPosition,
      },
    ],
    selectedRouteId: "primary",
    pathDefenderId: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlayer(value: unknown): value is Player {
  return typeof value === "string" && PLAYERS.has(value as Player);
}

function isPieceType(value: unknown): value is PieceType {
  return typeof value === "string" && PIECE_TYPES.has(value as PieceType);
}

function isPawnType(value: unknown): value is PawnType {
  return typeof value === "string" && PAWN_TYPES.has(value as PawnType);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isVec2(value: unknown, rows?: number, cols?: number): value is Vec2 {
  if (!Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[0]) || !Number.isInteger(value[1])) return false;
  return rows === undefined || cols === undefined || (value[0] >= 0 && value[0] < rows && value[1] >= 0 && value[1] < cols);
}

function isPiecesLeft(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ["Black", "White"].every((player) => {
    const inventory = value[player];
    return (
      isRecord(inventory) &&
      ["King", "AttackPawn", "DefensePawn", "ConquestPawn"].every((pieceType) => isNonNegativeInteger(inventory[pieceType]))
    );
  });
}

function isPendingPlacement(value: unknown): value is PendingPlacement | null {
  return value === null || (isRecord(value) && isPlayer(value.player) && isPieceType(value.pieceType));
}

function isVictory(value: unknown): value is VictoryResult | null {
  return (
    value === null ||
    (isRecord(value) &&
      isPlayer(value.winner) &&
      ["king_capture", "territory"].includes(String(value.reason)) &&
      (value.loser === undefined || value.loser === null || isPlayer(value.loser)))
  );
}

function isPreview(value: unknown, rows: number, cols: number): value is DefendedKingPreview {
  if (!isRecord(value)) return false;
  return (
    typeof value.attackerId === "string" &&
    typeof value.kingId === "string" &&
    isVec2(value.attackerOrigin, rows, cols) &&
    isVec2(value.kingPosition, rows, cols) &&
    isVec2(value.attackDirection) &&
    isVec2(value.bounceDirection) &&
    Array.isArray(value.attackPath) &&
    value.attackPath.every((pos) => isVec2(pos, rows, cols)) &&
    Array.isArray(value.bouncePath) &&
    value.bouncePath.every((pos) => isVec2(pos, rows, cols)) &&
    isVec2(value.landingPosition, rows, cols) &&
    (value.routes === undefined ||
      (Array.isArray(value.routes) &&
        value.routes.every(
          (route) =>
            isRecord(route) &&
            ["primary", "clockwise", "counterClockwise"].includes(String(route.id)) &&
            Array.isArray(route.path) &&
            route.path.every((pos) => isVec2(pos, rows, cols)) &&
            Array.isArray(route.jumpedSquares) &&
            route.jumpedSquares.every((pos) => isVec2(pos, rows, cols)) &&
            Array.isArray(route.turnSquares) &&
            route.turnSquares.every((pos) => isVec2(pos, rows, cols)) &&
            isVec2(route.landingPosition, rows, cols),
        ))) &&
    Array.isArray(value.eligibleDefenderIds) &&
    value.eligibleDefenderIds.every((id) => typeof id === "string") &&
    typeof value.triggersTransform === "boolean" &&
    isNonNegativeInteger(value.actionCost) &&
    typeof value.endsTurn === "boolean"
  );
}

function isAction(value: unknown, rows: number, cols: number): value is Action {
  if (!isRecord(value)) return false;
  return (
    ["move", "capture", "pass", "transform", "invalid"].includes(String(value.kind)) &&
    isPlayer(value.player) &&
    (value.start === undefined || isVec2(value.start, rows, cols)) &&
    (value.end === undefined || isVec2(value.end, rows, cols)) &&
    isNonNegativeInteger(value.cost) &&
    typeof value.capture === "boolean" &&
    typeof value.endsTurn === "boolean" &&
    (value.selectedDefender === undefined || value.selectedDefender === null || isVec2(value.selectedDefender, rows, cols)) &&
    (value.defendedKing === undefined || value.defendedKing === null || isPreview(value.defendedKing, rows, cols))
  );
}

function isPendingDefendedKing(value: unknown, rows: number, cols: number): value is PendingDefendedKing | null {
  return (
    value === null ||
    (isRecord(value) &&
      isPlayer(value.owner) &&
      isAction(value.action, rows, cols) &&
      isPreview(value.preview, rows, cols) &&
      Array.isArray(value.defenders) &&
      value.defenders.length > 0 &&
      value.defenders.every((pos) => isVec2(pos, rows, cols)))
  );
}

function isPendingTransform(value: unknown, rows: number, cols: number): value is PendingTransform | null {
  return (
    value === null ||
    (isRecord(value) &&
      isPlayer(value.owner) &&
      isPlayer(value.player) &&
      isVec2(value.pos, rows, cols) &&
      isPawnType(value.pieceType) &&
      typeof value.forceTurnSwitch === "boolean")
  );
}

function isBoardSnapshot(value: unknown): value is MatchSnapshot["board"] {
  if (!isRecord(value) || !isRecord(value.config)) return false;
  const rows = value.config.rows;
  const cols = value.config.cols;
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || Number(rows) <= 0 || Number(cols) <= 0) return false;
  if (!isNonNegativeInteger(value.config.special_count) || typeof value.config.transform_enabled !== "boolean") return false;
  if (!isNonNegativeInteger(value.config.transform_round)) return false;
  if (!Array.isArray(value.grid) || value.grid.length !== rows) return false;
  for (const row of value.grid) {
    if (!Array.isArray(row) || row.length !== cols) return false;
    for (const piece of row) {
      if (
        piece !== null &&
        (!isRecord(piece) ||
          !isPlayer(piece.player) ||
          !isPieceType(piece.type) ||
          (piece.id !== undefined && typeof piece.id !== "string") ||
          (piece.turns_since_transform !== undefined && !isNonNegativeInteger(piece.turns_since_transform)))
      ) {
        return false;
      }
    }
  }
  const controlledSquares = value.controlled_squares;
  if (
    controlledSquares !== undefined &&
    (!isRecord(controlledSquares) ||
      !["Black", "White"].every(
        (player) =>
          Array.isArray(controlledSquares[player]) && controlledSquares[player].every((pos) => isVec2(pos, Number(rows), Number(cols))),
      ))
  ) {
    return false;
  }
  if (value.captured_pieces !== undefined && !isPiecesLeft(value.captured_pieces)) return false;
  const claim = value.territory_claim;
  if (
    claim !== undefined &&
    claim !== null &&
    (!isRecord(claim) ||
      !isPlayer(claim.claimant) ||
      !isNonNegativeInteger(claim.created_turn) ||
      !isNonNegativeInteger(claim.mature_turn) ||
      claim.mature_turn < claim.created_turn)
  ) {
    return false;
  }
  return (
    Array.isArray(value.special_squares) &&
    value.special_squares.every((pos) => isVec2(pos, Number(rows), Number(cols))) &&
    Array.isArray(value.transform_squares) &&
    value.transform_squares.every((pos) => isVec2(pos, Number(rows), Number(cols)))
  );
}

export function toMatchSnapshot(state: MatchState): MatchSnapshot {
  const cloned = cloneMatchState(state);
  return {
    schema: 1,
    rulesVersion: cloned.rulesVersion,
    seed: cloned.seed,
    board: toPythonSnapshot(cloned.board),
    phase: cloned.phase,
    currentPlayer: cloned.currentPlayer,
    movesThisTurn: cloned.movesThisTurn,
    kingMoved: cloned.kingMoved,
    turnCounter: cloned.turnCounter,
    placementCursor: cloned.placementCursor,
    currentPlacement: cloned.currentPlacement,
    piecesLeft: clonePiecesLeft(cloned.piecesLeft),
    pendingDefendedKing: cloned.pendingDefendedKing,
    pendingTransform: cloned.pendingTransform,
    victory: cloned.victory,
  };
}

export function serializeState(state: MatchState): string {
  return JSON.stringify(toMatchSnapshot(state));
}

export function validateState(value: unknown): value is MatchSnapshot {
  if (!isRecord(value) || value.schema !== 1 || !isBoardSnapshot(value.board)) return false;
  const rows = value.board.config.rows;
  const cols = value.board.config.cols;
  if (
    (value.rulesVersion !== undefined && value.rulesVersion !== 1 && value.rulesVersion !== 2) ||
    (value.seed !== undefined && !Number.isInteger(value.seed)) ||
    typeof value.phase !== "string" ||
    !PHASES.has(value.phase as MatchState["phase"]) ||
    !isPlayer(value.currentPlayer) ||
    !isNonNegativeInteger(value.movesThisTurn) ||
    value.movesThisTurn > 2 ||
    typeof value.kingMoved !== "boolean" ||
    !isNonNegativeInteger(value.turnCounter) ||
    !isNonNegativeInteger(value.placementCursor) ||
    value.placementCursor > PLACEMENT_QUEUE.length ||
    !isPendingPlacement(value.currentPlacement) ||
    !isPiecesLeft(value.piecesLeft) ||
    !isPendingDefendedKing(value.pendingDefendedKing, rows, cols) ||
    !isPendingTransform(value.pendingTransform, rows, cols) ||
    !isVictory(value.victory)
  ) {
    return false;
  }

  if (value.phase === "placement") {
    if (value.placementCursor >= PLACEMENT_QUEUE.length || value.currentPlacement === null) return false;
    const expected = PLACEMENT_QUEUE[value.placementCursor];
    if (expected.player !== value.currentPlacement.player || expected.pieceType !== value.currentPlacement.pieceType) return false;
  } else if (value.currentPlacement !== null) {
    return false;
  }
  if (value.phase === "defenderSelection" && value.pendingDefendedKing === null) return false;
  if (value.phase !== "defenderSelection" && value.pendingDefendedKing !== null) return false;
  if (value.phase === "transformSelection" && value.pendingTransform === null) return false;
  if (value.phase !== "transformSelection" && value.phase !== "gameOver" && value.pendingTransform !== null) return false;
  if (value.phase === "gameOver" && value.victory === null) return false;
  if (value.phase !== "gameOver" && value.victory !== null) return false;
  return true;
}

export function deserializeState(raw: string): MatchState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!validateState(parsed)) return null;
    return {
      rulesVersion: parsed.rulesVersion ?? 1,
      seed: parsed.seed ?? 0,
      board: fromPythonSnapshot(parsed.board),
      phase: parsed.phase,
      currentPlayer: parsed.currentPlayer,
      movesThisTurn: parsed.movesThisTurn,
      kingMoved: parsed.kingMoved,
      turnCounter: parsed.turnCounter,
      placementCursor: parsed.placementCursor,
      currentPlacement: parsed.currentPlacement ? { ...parsed.currentPlacement } : null,
      piecesLeft: clonePiecesLeft(parsed.piecesLeft),
      pendingDefendedKing: parsed.pendingDefendedKing
        ? {
            ...parsed.pendingDefendedKing,
            preview: normalizeLegacyPreview(parsed.pendingDefendedKing.preview),
            action: {
              ...parsed.pendingDefendedKing.action,
              defendedKing: parsed.pendingDefendedKing.action.defendedKing
                ? normalizeLegacyPreview(parsed.pendingDefendedKing.action.defendedKing)
                : parsed.pendingDefendedKing.action.defendedKing,
            },
          }
        : null,
      pendingTransform: parsed.pendingTransform,
      victory: parsed.victory,
    };
  } catch {
    return null;
  }
}
