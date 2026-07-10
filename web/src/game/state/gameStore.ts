import { create } from "zustand";
import { chooseDeterministicAction } from "../ai/search";
import {
  applyAction,
  buildAction,
  canPlacePiece,
  cloneBoard,
  getPiece,
  hasPos,
  placePiece,
  transformPiece,
  updateControl,
  type Action,
  type Player,
} from "../engine";
import { DEFAULT_MATCH_CONFIG, resolveMatchConfig } from "../setup/matchConfig";
import { computeClockPatch, initialTimeLeft, monotonicNow } from "../clocks/clockController";
import { createHistoryEntry, restoreHistoryPatch } from "../history/historyController";
import {
  PLACEMENT_QUEUE,
  chooseQuickPlacementSquare,
  clonePiecesLeft,
  createBaseBoard,
  createEmptyPiecesLeft,
  createInitialPiecesLeft,
  createQuickBalancedBoard,
} from "../placement/placementSetup";
import { SAVE_KEY, buildRestorePatch, loadSavedGame, localStorageAvailable, savedGameFromState } from "../persistence/saveGame";
import { resolveCommit } from "../turn/commitAction";
import {
  actionTargets,
  advanceHalfTurn,
  defenderPositions,
  describePiece,
  squareName,
  switchPlayer,
  transformOptions,
} from "../turn/turnHelpers";
import type { GameState, GameStore, SavedGame } from "./storeTypes";

// The store is a thin coordinator: it owns the Zustand instance, initial state
// and the public action surface, and it wires set/get to the pure controller
// modules (placement, turn/commit, clocks, history, persistence). Rules stay in
// the engine; per-area logic stays in its controller. See
// docs/game-store-contract.md.
export const useGameStore = create<GameStore>((set, get) => {
  function syncClock(now = monotonicNow(), stopRunning = false): void {
    const patch = computeClockPatch(get(), now, stopRunning);
    if (Object.keys(patch).length > 0) {
      set(patch);
    }
  }

  function restoreSavedGame(saved: SavedGame, message = "Game loaded."): boolean {
    try {
      set(buildRestorePatch(saved, message));
      return true;
    } catch {
      set({ message: "Saved data could not be restored safely." });
      return false;
    }
  }

  function commitAction(action: Action, state: GameState): void {
    set(resolveCommit(state, action));
  }

  return {
    phase: { phase: "home" },
    board: createQuickBalancedBoard(),
    currentPlayer: "Black",
    movesThisTurn: 0,
    kingMoved: false,
    turnCounter: 0,
    selected: null,
    legalTargets: [],
    placementCursor: 0,
    currentPlacement: null,
    piecesLeft: createInitialPiecesLeft(),
    lastAction: "Ready.",
    message: "Choose a match flow.",
    history: [],
    pendingTransform: null,
    pendingDefendedKing: null,
    aiEnabled: false,
    aiPlayer: "White",
    hasActiveMatch: false,
    matchConfig: null,
    timeLeft: initialTimeLeft(DEFAULT_MATCH_CONFIG.timerSeconds),
    clockRunningFor: null,
    clockLastSyncMs: null,

    startConfiguredMatch: (config) => {
      const resolved = resolveMatchConfig(config);
      const aiEnabled = resolved.opponent === "Computer";
      const aiPlayer = resolved.aiSide ?? "White";
      const seed = resolved.setupSeed;
      if (resolved.placementMode === "QuickBalanced") {
        set({
          phase: { phase: "playing", previousPhase: "setup" },
          board: createQuickBalancedBoard(resolved.transformEnabled, seed),
          currentPlayer: "Black",
          movesThisTurn: 0,
          kingMoved: false,
          turnCounter: 0,
          selected: null,
          legalTargets: [],
          placementCursor: PLACEMENT_QUEUE.length,
          currentPlacement: null,
          piecesLeft: createEmptyPiecesLeft(),
          history: [],
          pendingTransform: null,
          pendingDefendedKing: null,
          aiEnabled,
          aiPlayer,
          hasActiveMatch: true,
          matchConfig: resolved,
          timeLeft: initialTimeLeft(resolved.timerSeconds),
          clockRunningFor: null,
          clockLastSyncMs: null,
          lastAction: "Quick Balanced deployment complete.",
          message: "Black to move.",
        });
        return;
      }

      const first = PLACEMENT_QUEUE[0];
      set({
        phase: { phase: "placement", previousPhase: "setup" },
        board: createBaseBoard(resolved.transformEnabled, seed),
        currentPlayer: first.player,
        movesThisTurn: 0,
        kingMoved: false,
        turnCounter: 0,
        selected: null,
        legalTargets: [],
        placementCursor: 0,
        currentPlacement: first,
        piecesLeft: createInitialPiecesLeft(),
        history: [],
        pendingTransform: null,
        pendingDefendedKing: null,
        aiEnabled,
        aiPlayer,
        hasActiveMatch: true,
        matchConfig: resolved,
        timeLeft: initialTimeLeft(resolved.timerSeconds),
        clockRunningFor: null,
        clockLastSyncMs: null,
        lastAction: "Manual deployment started.",
        message: `${first.player}: place ${describePiece(first.pieceType)}.`,
      });
    },

    startQuickMatch: (options = {}) => {
      set({
        phase: { phase: "playing", previousPhase: "home" },
        board: createQuickBalancedBoard(options.transformEnabled ?? false, options.seed),
        currentPlayer: "Black",
        movesThisTurn: 0,
        kingMoved: false,
        turnCounter: 0,
        selected: null,
        legalTargets: [],
        placementCursor: PLACEMENT_QUEUE.length,
        currentPlacement: null,
        piecesLeft: createEmptyPiecesLeft(),
        history: [],
        pendingTransform: null,
        pendingDefendedKing: null,
        aiEnabled: options.aiEnabled ?? false,
        aiPlayer: options.aiPlayer ?? "White",
        hasActiveMatch: true,
        matchConfig: {
          ...DEFAULT_MATCH_CONFIG,
          opponent: options.aiEnabled ? "Computer" : "Human",
          humanSide: options.aiPlayer === "Black" ? "White" : "Black",
          resolvedHumanSide: options.aiEnabled ? (options.aiPlayer === "Black" ? "White" : "Black") : null,
          aiSide: options.aiEnabled ? (options.aiPlayer ?? "White") : null,
          placementMode: "QuickBalanced",
          transformEnabled: options.transformEnabled ?? false,
          setupSeed: options.seed,
        },
        timeLeft: initialTimeLeft(DEFAULT_MATCH_CONFIG.timerSeconds),
        clockRunningFor: null,
        clockLastSyncMs: null,
        lastAction: "Quick Balanced deployment complete.",
        message: "Black to move.",
      });
    },

    startAiMatch: () => get().startQuickMatch({ aiEnabled: true }),
    startTransformMatch: () => get().startQuickMatch({ transformEnabled: true }),

    startManualPlacement: (options = {}) => {
      const first = PLACEMENT_QUEUE[0];
      set({
        phase: { phase: "placement", previousPhase: "home" },
        board: createBaseBoard(options.transformEnabled ?? false, options.seed),
        currentPlayer: first.player,
        movesThisTurn: 0,
        kingMoved: false,
        turnCounter: 0,
        selected: null,
        legalTargets: [],
        placementCursor: 0,
        currentPlacement: first,
        piecesLeft: createInitialPiecesLeft(),
        history: [],
        pendingTransform: null,
        pendingDefendedKing: null,
        aiEnabled: options.aiEnabled ?? false,
        aiPlayer: options.aiPlayer ?? "White",
        hasActiveMatch: true,
        matchConfig: {
          ...DEFAULT_MATCH_CONFIG,
          opponent: options.aiEnabled ? "Computer" : "Human",
          humanSide: options.aiPlayer === "Black" ? "White" : "Black",
          resolvedHumanSide: options.aiEnabled ? (options.aiPlayer === "Black" ? "White" : "Black") : null,
          aiSide: options.aiEnabled ? (options.aiPlayer ?? "White") : null,
          placementMode: "Manual",
          transformEnabled: options.transformEnabled ?? false,
          setupSeed: options.seed,
        },
        timeLeft: initialTimeLeft(DEFAULT_MATCH_CONFIG.timerSeconds),
        clockRunningFor: null,
        clockLastSyncMs: null,
        lastAction: "Manual deployment started.",
        message: `${first.player}: place ${describePiece(first.pieceType)}.`,
      });
    },

    openRules: () => set((state) => ({ phase: { phase: "rules", previousPhase: state.phase.phase } })),

    returnHome: () =>
      set({
        selected: null,
        legalTargets: [],
        pendingTransform: null,
        pendingDefendedKing: null,
        clockRunningFor: null,
        clockLastSyncMs: null,
        message: get().hasActiveMatch ? "Match preserved on the Home page." : "Choose a match flow.",
      }),

    activateSquare: (pos) => {
      const state = get();
      if (state.phase.phase === "defenderSelection") {
        state.chooseDefender(pos);
        return;
      }
      if (state.phase.phase === "transformSelection") {
        return;
      }
      if (state.phase.phase === "placement") {
        const item = PLACEMENT_QUEUE[state.placementCursor];
        if (!item) return;
        if (state.aiEnabled && item.player === state.aiPlayer) {
          set({ message: `Computer is placing ${describePiece(item.pieceType)}.` });
          return;
        }
        const result = canPlacePiece(state.board, pos, item.player, item.pieceType);
        if (!result.ok) {
          set({ message: result.reason ?? "Invalid placement." });
          return;
        }
        const board = cloneBoard(state.board);
        placePiece(board, pos, item.player, item.pieceType);
        const piecesLeft = clonePiecesLeft(state.piecesLeft);
        piecesLeft[item.player][item.pieceType] -= 1;
        const nextCursor = state.placementCursor + 1;
        const nextItem = PLACEMENT_QUEUE[nextCursor];
        updateControl(board);
        set({
          board,
          piecesLeft,
          placementCursor: nextCursor,
          currentPlacement: nextItem ?? null,
          currentPlayer: nextItem?.player ?? "Black",
          phase: nextItem ? state.phase : { phase: "playing", previousPhase: "placement" },
          history: [...state.history, createHistoryEntry(state)],
          lastAction: `${item.player} placed ${describePiece(item.pieceType)} on ${squareName(pos)}.`,
          message: nextItem ? `${nextItem.player}: place ${describePiece(nextItem.pieceType)}.` : "Deployment complete. Black to move.",
        });
        return;
      }

      if (state.phase.phase !== "playing") {
        return;
      }

      if (state.aiEnabled && state.currentPlayer === state.aiPlayer) {
        set({ message: "Computer is thinking." });
        return;
      }

      const piece = getPiece(state.board, pos);
      if (!state.selected) {
        if (piece?.player === state.currentPlayer) {
          set({
            selected: pos,
            legalTargets: actionTargets(state.board, pos, state.movesThisTurn, state.kingMoved),
            message: `${piece.player} ${describePiece(piece.type)} selected.`,
          });
        }
        return;
      }

      if (piece?.player === state.currentPlayer) {
        set({
          selected: pos,
          legalTargets: actionTargets(state.board, pos, state.movesThisTurn, state.kingMoved),
          message: `${piece.player} ${describePiece(piece.type)} selected.`,
        });
        return;
      }

      if (!hasPos(state.legalTargets, pos)) {
        set({ selected: null, legalTargets: [], message: "Selection cancelled." });
        return;
      }

      const action = buildAction(state.board, state.selected, pos, {
        movesThisTurn: state.movesThisTurn,
        kingMoved: state.kingMoved,
      });
      if (action.error) {
        set({ message: action.error, selected: null, legalTargets: [] });
        return;
      }
      if (action.defendedKing && !action.selectedDefender) {
        const defenders = defenderPositions(state.board, action);
        const defenderOwner = switchPlayer(action.player as Player);
        set({
          phase: { phase: "defenderSelection", previousPhase: "playing" },
          pendingDefendedKing: { owner: defenderOwner, action, preview: action.defendedKing, defenders },
          selected: action.end ?? state.selected,
          legalTargets: defenders,
          message:
            defenders.length === 1
              ? `${defenderOwner}: confirm the highlighted Defense Pawn sacrifice.`
              : `${defenderOwner}: choose a Defense Pawn to sacrifice.`,
        });
        return;
      }
      commitAction(action, state);
    },

    chooseDefender: (pos) => {
      const state = get();
      const pending = state.pendingDefendedKing;
      if (!pending || !hasPos(pending.defenders, pos)) {
        set({ message: "Choose one of the highlighted Defense Pawns." });
        return;
      }
      commitAction({ ...pending.action, selectedDefender: pos }, state);
    },

    cancelDefenderSelection: () => {
      const state = get();
      const pending = state.pendingDefendedKing;
      set({
        phase: { phase: "playing", previousPhase: "defenderSelection" },
        pendingDefendedKing: null,
        selected: pending?.action.start ?? null,
        legalTargets: pending?.action.start ? actionTargets(state.board, pending.action.start, state.movesThisTurn, state.kingMoved) : [],
        message: "Defended-King attack cancelled.",
      });
    },

    chooseTransform: (newType) => {
      const state = get();
      const pending = state.pendingTransform;
      if (!pending) return;
      const { board, result } = transformPiece(state.board, pending.pos, newType, state.turnCounter + 1);
      if (result.error) {
        set({ message: result.error });
        return;
      }

      let currentPlayer = state.currentPlayer;
      let turnCounter = state.turnCounter;
      let victory = result.victory;
      if (pending.forceTurnSwitch) {
        const advanced = advanceHalfTurn(board, state);
        currentPlayer = advanced.currentPlayer;
        turnCounter = advanced.turnCounter;
        victory ??= advanced.victory;
      }

      set({
        board,
        currentPlayer,
        movesThisTurn: 0,
        kingMoved: false,
        turnCounter,
        pendingTransform: null,
        phase: victory
          ? { phase: "gameOver", previousPhase: "transformSelection" }
          : { phase: "playing", previousPhase: "transformSelection" },
        lastAction: `${pending.player} transformed into ${describePiece(newType)} on ${squareName(pending.pos)}.`,
        message: victory ? `${victory.winner} wins by ${victory.reason}.` : `${currentPlayer} to move.`,
      });
    },

    passTurn: () => {
      const state = get();
      if (state.phase.phase !== "playing") return;
      const pass: Action = { kind: "pass", player: state.currentPlayer, cost: 0, capture: false, endsTurn: true };
      const { board } = applyAction(state.board, pass);
      const advanced = advanceHalfTurn(board, state);
      set({
        board,
        currentPlayer: advanced.currentPlayer,
        movesThisTurn: 0,
        kingMoved: false,
        turnCounter: advanced.turnCounter,
        selected: null,
        legalTargets: [],
        history: [...state.history, createHistoryEntry(state)],
        phase: advanced.victory ? { phase: "gameOver", previousPhase: "playing" } : state.phase,
        lastAction: `${state.currentPlayer} passed.`,
        message: advanced.victory ? `${advanced.victory.winner} wins by ${advanced.victory.reason}.` : `${advanced.currentPlayer} to move.`,
      });
    },

    undo: () => {
      const state = get();
      const previous = state.history.at(-1);
      if (!previous) {
        set({ message: "Nothing to undo." });
        return;
      }
      set(restoreHistoryPatch(previous, state.history.slice(0, -1)));
    },

    runAiTurn: () => {
      const state = get();
      if (!state.aiEnabled) return;
      if (state.phase.phase === "placement" && state.currentPlacement?.player === state.aiPlayer) {
        const item = PLACEMENT_QUEUE[state.placementCursor];
        if (!item) return;
        const pos = chooseQuickPlacementSquare(state.board, item.player, item.pieceType);
        const board = cloneBoard(state.board);
        placePiece(board, pos, item.player, item.pieceType);
        const piecesLeft = clonePiecesLeft(state.piecesLeft);
        piecesLeft[item.player][item.pieceType] -= 1;
        const nextCursor = state.placementCursor + 1;
        const nextItem = PLACEMENT_QUEUE[nextCursor];
        updateControl(board);
        set({
          board,
          piecesLeft,
          placementCursor: nextCursor,
          currentPlacement: nextItem ?? null,
          currentPlayer: nextItem?.player ?? "Black",
          phase: nextItem ? state.phase : { phase: "playing", previousPhase: "placement" },
          history: [...state.history, createHistoryEntry(state)],
          lastAction: `${item.player} placed ${describePiece(item.pieceType)} on ${squareName(pos)}.`,
          message: nextItem ? `${nextItem.player}: place ${describePiece(nextItem.pieceType)}.` : "Deployment complete. Black to move.",
        });
        return;
      }
      if (state.phase.phase === "transformSelection") {
        if (state.pendingTransform?.owner !== state.aiPlayer) return;
        const options = transformOptions(state.pendingTransform.pieceType);
        state.chooseTransform(options[0]);
        return;
      }
      if (state.phase.phase === "defenderSelection") {
        if (state.pendingDefendedKing?.owner !== state.aiPlayer) return;
        state.chooseDefender(state.pendingDefendedKing.defenders[0]);
        return;
      }
      if (state.currentPlayer !== state.aiPlayer) return;
      if (state.phase.phase !== "playing") return;
      const action = chooseDeterministicAction(state.board, state.currentPlayer, state.movesThisTurn, state.kingMoved);
      if (action.kind === "pass") {
        state.passTurn();
        return;
      }
      if (action.defendedKing && !action.selectedDefender) {
        const defenders = defenderPositions(state.board, action);
        const owner = switchPlayer(action.player as Player);
        if (owner === state.aiPlayer) {
          commitAction({ ...action, selectedDefender: defenders[0] }, state);
          return;
        }
        set({
          phase: { phase: "defenderSelection", previousPhase: "playing" },
          pendingDefendedKing: { owner, action, preview: action.defendedKing, defenders },
          selected: action.end ?? action.start ?? null,
          legalTargets: defenders,
          message:
            defenders.length === 1
              ? `${owner}: confirm the highlighted Defense Pawn sacrifice.`
              : `${owner}: choose a Defense Pawn to sacrifice.`,
        });
        return;
      }
      commitAction(action, state);
    },

    startClock: (now) => {
      const state = get();
      if (!state.matchConfig || state.matchConfig.timerSeconds === 0 || state.phase.phase !== "playing") {
        return;
      }
      if (state.aiEnabled && state.currentPlayer === state.aiPlayer) {
        return;
      }
      syncClock(now, true);
      const latest = get();
      if (latest.phase.phase === "gameOver") {
        return;
      }
      set({ clockRunningFor: latest.currentPlayer, clockLastSyncMs: now });
    },

    stopClock: (now) => syncClock(now, true),

    tickClock: (now) => syncClock(now, false),

    saveGame: () => {
      syncClock(monotonicNow(), false);
      const state = get();
      if (!localStorageAvailable()) {
        set({ message: "Save is not available in this environment." });
        return;
      }
      try {
        window.localStorage.setItem(SAVE_KEY, JSON.stringify(savedGameFromState(state)));
      } catch {
        // Storage write can throw (e.g. quota exceeded). Never corrupt the
        // in-memory match; report the failure instead.
        set({ message: "Could not save: local storage is full or unavailable." });
        return;
      }
      set({ message: "Game saved locally." });
    },

    loadGame: () => {
      if (!localStorageAvailable()) {
        set({ message: "Load is not available in this environment." });
        return;
      }
      const saved = loadSavedGame(window.localStorage.getItem(SAVE_KEY) ?? "");
      if (!saved) {
        set({ message: "No valid local save found." });
        return;
      }
      restoreSavedGame(saved);
    },

    exportSaveJson: () => {
      syncClock(monotonicNow(), false);
      try {
        return JSON.stringify(savedGameFromState(get()), null, 2);
      } catch {
        set({ message: "Save export failed." });
        return null;
      }
    },

    importSaveJson: (raw) => {
      const saved = loadSavedGame(raw);
      if (!saved) {
        set({ message: "Imported save is invalid or unsupported." });
        return false;
      }
      if (!restoreSavedGame(saved, "Imported save loaded.")) {
        return false;
      }
      try {
        if (localStorageAvailable()) {
          window.localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
        }
      } catch {
        set({ message: "Imported save loaded, but could not be written to local storage." });
      }
      return true;
    },
  };
});
