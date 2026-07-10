// Persistence extracted from the store: save construction, strict validation of
// untrusted saves, localStorage availability, and the pure restore patch. These
// functions never touch the store; the store owns read/write and set/get. Schema
// 1 and 2 are both accepted; malformed or unknown-schema saves are rejected
// atomically; generated squares are restored verbatim (no reroll); terminal-game
// messages are preserved.
import { fromPythonSnapshot, toPythonSnapshot, type Player } from "../engine";
import { DEFAULT_MATCH_CONFIG } from "../setup/matchConfig";
import { clonePiecesLeft, TOTAL_PLACEMENTS } from "../placement/placementSetup";
import { initialTimeLeft } from "../clocks/clockController";
import type { GameState, SavedGame, StatePatch } from "../state/storeTypes";

export const SAVE_KEY = "assalto-reale-save";

const VALID_PIECE_TYPES = new Set<string>([
  "AttackPawn",
  "DefensePawn",
  "ConquestPawn",
  "King",
]);
const VALID_PHASES = new Set<string>([
  "home",
  "setup",
  "placement",
  "playing",
  "defenderSelection",
  "transformSelection",
  "gameOver",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlayer(value: unknown): value is Player {
  return value === "Black" || value === "White";
}

function isValidTimeLeft(value: unknown): value is Record<Player, number> {
  return (
    isRecord(value) &&
    typeof value.Black === "number" &&
    typeof value.White === "number" &&
    value.Black >= 0 &&
    value.White >= 0
  );
}

function isValidPiece(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPlayer(value.player) &&
    typeof value.type === "string" &&
    VALID_PIECE_TYPES.has(value.type)
  );
}

function isWithinBounds(pos: unknown, rows: number, cols: number): boolean {
  return (
    Array.isArray(pos) &&
    pos.length === 2 &&
    Number.isInteger(pos[0]) &&
    Number.isInteger(pos[1]) &&
    pos[0] >= 0 &&
    pos[0] < rows &&
    pos[1] >= 0 &&
    pos[1] < cols
  );
}

function isValidBoardSnapshot(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.config)) return false;
  const { rows, cols } = value.config;
  if (
    typeof rows !== "number" ||
    typeof cols !== "number" ||
    rows <= 0 ||
    cols <= 0
  )
    return false;
  if (!Array.isArray(value.grid) || value.grid.length !== rows) return false;
  for (const row of value.grid) {
    if (!Array.isArray(row) || row.length !== cols) return false;
    for (const cell of row) {
      if (cell !== null && !isValidPiece(cell)) return false;
    }
  }
  for (const key of ["special_squares", "transform_squares"] as const) {
    if (!Array.isArray(value[key])) return false;
    for (const pos of value[key] as unknown[]) {
      if (!isWithinBounds(pos, rows, cols)) return false;
    }
  }
  return true;
}

function isValidPendingOwner(value: unknown): boolean {
  // Absent/null pending decisions are allowed; when present the owner must be a player.
  return value == null || (isRecord(value) && isPlayer(value.owner));
}

export function validateSavedGame(value: unknown): SavedGame | null {
  if (!isRecord(value)) return null;
  if (value.schema !== 1 && value.schema !== 2) return null;
  if (
    !isRecord(value.phase) ||
    typeof value.phase.phase !== "string" ||
    !VALID_PHASES.has(value.phase.phase)
  )
    return null;
  if (!isValidBoardSnapshot(value.board)) return null;
  if (!isPlayer(value.currentPlayer) || !isPlayer(value.aiPlayer)) return null;
  if (
    typeof value.movesThisTurn !== "number" ||
    value.movesThisTurn < 0 ||
    value.movesThisTurn > 2
  )
    return null;
  if (typeof value.kingMoved !== "boolean") return null;
  if (typeof value.turnCounter !== "number" || value.turnCounter < 0)
    return null;
  if (
    typeof value.placementCursor !== "number" ||
    value.placementCursor < 0 ||
    value.placementCursor > TOTAL_PLACEMENTS
  )
    return null;
  if (!isRecord(value.piecesLeft)) return null;
  if (typeof value.lastAction !== "string" || typeof value.message !== "string")
    return null;
  if (
    typeof value.aiEnabled !== "boolean" ||
    typeof value.hasActiveMatch !== "boolean"
  )
    return null;
  if (!isValidTimeLeft(value.timeLeft)) return null;
  if (
    !isValidPendingOwner(value.pendingDefendedKing) ||
    !isValidPendingOwner(value.pendingTransform)
  )
    return null;
  return value as unknown as SavedGame;
}

export function loadSavedGame(raw: string): SavedGame | null {
  try {
    return validateSavedGame(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function localStorageAvailable(): boolean {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

export function savedGameFromState(state: GameState): SavedGame {
  return {
    schema: 2,
    appVersion: "web-v1",
    savedAt: new Date().toISOString(),
    board: toPythonSnapshot(state.board),
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    movesThisTurn: state.movesThisTurn,
    kingMoved: state.kingMoved,
    turnCounter: state.turnCounter,
    placementCursor: state.placementCursor,
    currentPlacement: state.currentPlacement,
    piecesLeft: state.piecesLeft,
    lastAction: state.lastAction,
    message: state.message,
    aiEnabled: state.aiEnabled,
    aiPlayer: state.aiPlayer,
    hasActiveMatch: state.hasActiveMatch,
    matchConfig: state.matchConfig,
    timeLeft: state.timeLeft,
    pendingTransform: state.pendingTransform,
    pendingDefendedKing: state.pendingDefendedKing,
    history: state.history,
  };
}

/**
 * Pure restore payload. May throw if `fromPythonSnapshot` rejects the board; the
 * caller wraps it so a bad save never corrupts the in-memory match.
 */
export function buildRestorePatch(
  saved: SavedGame,
  message = "Game loaded.",
): StatePatch {
  return {
    board: fromPythonSnapshot(saved.board),
    phase: saved.phase,
    currentPlayer: saved.currentPlayer,
    movesThisTurn: saved.movesThisTurn,
    kingMoved: saved.kingMoved,
    turnCounter: saved.turnCounter,
    placementCursor: saved.placementCursor,
    currentPlacement: saved.currentPlacement,
    piecesLeft: clonePiecesLeft(saved.piecesLeft),
    // Preserve the saved victory message for terminal matches so the victory
    // presentation shows the correct winner/reason; otherwise use the load message.
    message: saved.phase.phase === "gameOver" ? saved.message : message,
    aiEnabled: saved.aiEnabled,
    aiPlayer: saved.aiPlayer,
    hasActiveMatch: saved.hasActiveMatch ?? true,
    matchConfig: saved.matchConfig ?? null,
    timeLeft:
      saved.timeLeft ?? initialTimeLeft(DEFAULT_MATCH_CONFIG.timerSeconds),
    clockRunningFor: null,
    clockLastSyncMs: null,
    selected: null,
    legalTargets: [],
    pendingTransform:
      saved.schema === 2 ? (saved.pendingTransform ?? null) : null,
    pendingDefendedKing:
      saved.schema === 2 ? (saved.pendingDefendedKing ?? null) : null,
    history: saved.schema === 2 ? (saved.history ?? []) : [],
  };
}
