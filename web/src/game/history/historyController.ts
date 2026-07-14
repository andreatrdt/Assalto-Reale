// Undo history extracted from the store. `createHistoryEntry` snapshots the
// stable pre-action state; `restoreHistoryPatch` turns a snapshot back into a
// state patch. Undo policy is unchanged: history is pushed on each committed
// action/placement/pass and pops one stable-state snapshot, clearing selection
// and stopping the clock on restore.
import { cloneBoard } from "../engine";
import { clonePiecesLeft } from "../placement/placementSetup";
import type { GameState, HistoryEntry, StatePatch } from "../state/storeTypes";

export function createHistoryEntry(state: GameState): HistoryEntry {
  return {
    board: cloneBoard(state.board),
    currentPlayer: state.currentPlayer,
    movesThisTurn: state.movesThisTurn,
    kingMoved: state.kingMoved,
    turnCounter: state.turnCounter,
    placementCursor: state.placementCursor,
    currentPlacement: state.currentPlacement,
    piecesLeft: clonePiecesLeft(state.piecesLeft),
    phase: { ...state.phase },
    lastAction: state.lastAction,
    message: state.message,
    pendingTransform: state.pendingTransform,
    pendingDefendedKing: state.pendingDefendedKing,
    timeLeft: { ...state.timeLeft },
  };
}

export function restoreHistoryPatch(previous: HistoryEntry, remainingHistory: HistoryEntry[]): StatePatch {
  return {
    board: cloneBoard(previous.board),
    currentPlayer: previous.currentPlayer,
    movesThisTurn: previous.movesThisTurn,
    kingMoved: previous.kingMoved,
    turnCounter: previous.turnCounter,
    placementCursor: previous.placementCursor,
    currentPlacement: previous.currentPlacement,
    piecesLeft: clonePiecesLeft(previous.piecesLeft),
    phase: previous.phase,
    lastAction: previous.lastAction,
    message: "Undone.",
    timeLeft: { ...previous.timeLeft },
    pendingTransform: previous.pendingTransform,
    pendingDefendedKing: previous.pendingDefendedKing,
    projectedDefendedKing: null,
    resolvedDefendedKing: null,
    clockRunningFor: null,
    clockLastSyncMs: null,
    selected: null,
    legalTargets: [],
    history: remainingHistory,
  };
}
