import { create } from "zustand";
import { chooseDeterministicAction } from "../ai/search";
import {
  buildAction,
  chooseQuickPlacementSquare,
  getPiece,
  getTransformEligibility,
  hasPos,
  type DeflectionRouteId,
  type Player,
  type Vec2,
} from "../engine";
import { DEFAULT_MATCH_CONFIG, resolveMatchConfig } from "../setup/matchConfig";
import { computeClockPatch, initialTimeLeft, monotonicNow } from "../clocks/clockController";
import { restoreHistoryPatch } from "../history/historyController";
import { SAVE_KEY, buildRestorePatch, loadSavedGame, localStorageAvailable, savedGameFromState } from "../persistence/saveGame";
import { actionTargets, describePiece } from "../turn/turnHelpers";
import {
  createMatchState,
  runStoreCommand,
  runStoreSubmittedAction,
  storePatchFromCoreMatch,
  toCoreMatchState,
} from "../core/matchAdapter";
import type { GameCommand } from "../engine";
import type { GameState, GameStore, SavedGame } from "./storeTypes";

// `useGameStore` remains the public UI contract. Canonical setup, placement,
// legal commands, pending decisions and turn progression live in
// `packages/game-core`; this module adapts their semantic results to the
// established Zustand fields/messages/history and owns browser-only lifecycle,
// clocks, localStorage and AI scheduling. See docs/game-store-contract.md.
export const useGameStore = create<GameStore>((set, get) => {
  function syncClock(now = monotonicNow(), stopRunning = false): void {
    const patch = computeClockPatch(get(), now, stopRunning);
    if (Object.keys(patch).length > 0) {
      set(patch.phase?.phase === "gameOver" ? { ...patch, hasActiveMatch: false } : patch);
    }
  }

  function restoreSavedGame(saved: SavedGame, message = "Game loaded."): boolean {
    try {
      const patch = buildRestorePatch(saved, message);
      set(patch.phase?.phase === "gameOver" ? { ...patch, hasActiveMatch: false } : patch);
      return true;
    } catch {
      set({ message: "Saved data could not be restored safely." });
      return false;
    }
  }

  function applyStoreCommand(command: GameCommand, options: { historySource?: GameState; phaseCommand?: GameCommand } = {}): boolean {
    const { result, patch } = runStoreCommand(get(), command, options);
    set(patch.phase?.phase === "gameOver" ? { ...patch, hasActiveMatch: false } : patch);
    return result.ok;
  }

  function applySubmittedAction(start: Vec2, end: Vec2, autoResolveDefenderFor?: Player, routeId?: DeflectionRouteId): boolean {
    const { result, patch } = runStoreSubmittedAction(get(), start, end, autoResolveDefenderFor, routeId);
    const withProjectionCleared = { ...patch, projectedDefendedKing: null };
    set(patch.phase?.phase === "gameOver" ? { ...withProjectionCleared, hasActiveMatch: false } : withProjectionCleared);
    return result.ok;
  }

  const initialMatch = createMatchState({
    placementMode: "Manual",
    transformEnabled: DEFAULT_MATCH_CONFIG.transformEnabled,
    seed: 0,
  });

  return {
    rulesVersion: initialMatch.rulesVersion,
    seed: initialMatch.seed,
    phase: { phase: "home" },
    board: initialMatch.board,
    currentPlayer: initialMatch.currentPlayer,
    movesThisTurn: initialMatch.movesThisTurn,
    kingMoved: initialMatch.kingMoved,
    turnCounter: initialMatch.turnCounter,
    selected: null,
    legalTargets: [],
    placementCursor: initialMatch.placementCursor,
    currentPlacement: initialMatch.currentPlacement,
    piecesLeft: initialMatch.piecesLeft,
    lastAction: "Ready.",
    message: "Choose a match flow.",
    history: [],
    pendingTransform: null,
    pendingDefendedKing: null,
    projectedDefendedKing: null,
    resolvedDefendedKing: null,
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
      // Every match always begins in the placement phase. There is no quick or
      // preconfigured deployment: Manual is forced regardless of the incoming
      // config (e.g. restarting a legacy saved game that stored another mode).
      const match = createMatchState({
        placementMode: "Manual",
        transformEnabled: resolved.transformEnabled,
        // resolveMatchConfig always assigns setupSeed; the fallback only
        // satisfies the optional type and is never reached at runtime.
        seed: resolved.setupSeed ?? 0,
      });
      set({
        ...storePatchFromCoreMatch(match, "setup"),
        aiEnabled,
        aiPlayer,
        hasActiveMatch: true,
        matchConfig: { ...resolved, placementMode: "Manual" },
        timeLeft: initialTimeLeft(resolved.timerSeconds),
        clockRunningFor: null,
        clockLastSyncMs: null,
        lastAction: "Manual deployment started.",
        message: `${match.currentPlacement?.player}: place ${describePiece(match.currentPlacement?.pieceType ?? "King")}.`,
      });
    },

    startManualPlacement: (options = {}) => {
      const seed = options.seed ?? Math.floor(Math.random() * 0xffffffff) >>> 0;
      const match = createMatchState({
        placementMode: "Manual",
        transformEnabled: options.transformEnabled ?? false,
        seed,
      });
      set({
        ...storePatchFromCoreMatch(match, "home"),
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
          setupSeed: seed,
        },
        timeLeft: initialTimeLeft(DEFAULT_MATCH_CONFIG.timerSeconds),
        clockRunningFor: null,
        clockLastSyncMs: null,
        lastAction: "Manual deployment started.",
        message: `${match.currentPlacement?.player}: place ${describePiece(match.currentPlacement?.pieceType ?? "King")}.`,
      });
    },

    openRules: () =>
      set((state) => ({
        phase: { phase: "rules", previousPhase: state.phase.phase },
      })),

    returnHome: () => {
      const completed = get().phase.phase === "gameOver";
      set({
        selected: null,
        legalTargets: [],
        pendingTransform: null,
        pendingDefendedKing: null,
        projectedDefendedKing: null,
        resolvedDefendedKing: null,
        clockRunningFor: null,
        clockLastSyncMs: null,
        hasActiveMatch: completed ? false : get().hasActiveMatch,
        message: !completed && get().hasActiveMatch ? "Match preserved on the Home page." : "Choose a match flow.",
      });
    },

    activateSquare: (pos) => {
      const state = get();
      if (state.projectedDefendedKing) {
        const projected = state.projectedDefendedKing.preview;
        if (hasPos([projected.attackerOrigin], pos)) {
          set({ projectedDefendedKing: null, selected: null, legalTargets: [], message: "Defended King preview cancelled." });
          return;
        }
        const projectedPiece = getPiece(state.board, pos);
        if (projectedPiece?.player === state.currentPlayer) {
          set({
            projectedDefendedKing: null,
            selected: pos,
            legalTargets: actionTargets(state.board, pos, state.movesThisTurn, state.kingMoved, state.rulesVersion),
            message: `${projectedPiece.player} ${describePiece(projectedPiece.type)} selected.`,
          });
          return;
        }
        if (hasPos([projected.kingPosition], pos)) {
          applySubmittedAction(projected.attackerOrigin, projected.kingPosition, undefined, projected.selectedRouteId);
          return;
        }
        const chosenRoute = projected.routes.find((route) => hasPos(route.path, pos) || hasPos([route.landingPosition], pos));
        if (chosenRoute) {
          set({
            projectedDefendedKing: {
              ...state.projectedDefendedKing,
              preview: {
                ...projected,
                selectedRouteId: chosenRoute.id,
                bouncePath: chosenRoute.path,
                landingPosition: chosenRoute.landingPosition,
              },
            },
            message: `${chosenRoute.id === "primary" ? "Primary" : chosenRoute.id === "clockwise" ? "Clockwise" : "Counter-clockwise"} route selected. Click the King to commit.`,
          });
          return;
        }
        set({ projectedDefendedKing: null, selected: null, legalTargets: [], message: "Defended King preview cancelled." });
        return;
      }
      if (state.phase.phase === "defenderSelection") {
        state.chooseDefender(pos);
        return;
      }
      if (state.phase.phase === "transformSelection") return;
      if (state.phase.phase === "placement") {
        if (state.aiEnabled && state.currentPlacement?.player === state.aiPlayer) {
          set({ message: `Computer is placing ${describePiece(state.currentPlacement.pieceType)}.` });
          return;
        }
        applyStoreCommand({ type: "PlacePiece", position: pos });
        return;
      }
      if (state.phase.phase !== "playing") return;
      if (state.aiEnabled && state.currentPlayer === state.aiPlayer) {
        set({ message: "Computer is thinking." });
        return;
      }

      const piece = getPiece(state.board, pos);
      if (!state.selected) {
        if (piece?.player === state.currentPlayer) {
          set({
            selected: pos,
            legalTargets: actionTargets(state.board, pos, state.movesThisTurn, state.kingMoved, state.rulesVersion),
            message: `${piece.player} ${describePiece(piece.type)} selected.`,
          });
        }
        return;
      }
      if (piece?.player === state.currentPlayer) {
        if (state.selected && hasPos([state.selected], pos) && hasPos(state.board.transformSquares, pos)) {
          applyStoreCommand({ type: "ActivateTransform", position: pos });
          return;
        }
        set({
          selected: pos,
          legalTargets: actionTargets(state.board, pos, state.movesThisTurn, state.kingMoved, state.rulesVersion),
          message: `${piece.player} ${describePiece(piece.type)} selected.`,
        });
        return;
      }
      if (!hasPos(state.legalTargets, pos)) {
        set({ selected: null, legalTargets: [], message: "Selection cancelled." });
        return;
      }
      const projectedAction = buildAction(state.board, state.selected, pos, {
        movesThisTurn: state.movesThisTurn,
        kingMoved: state.kingMoved,
        rulesVersion: state.rulesVersion,
      });
      if (projectedAction.defendedKing) {
        const defenders = projectedAction.defendedKing.pathDefenderId
          ? projectedAction.defendedKing.attackPath.slice(0, -1)
          : (state.pendingDefendedKing?.defenders ?? []);
        set({
          projectedDefendedKing: { preview: projectedAction.defendedKing, defenders },
          message: "Projected defended-King outcome. Click a route if offered, then click the King again to commit.",
        });
        return;
      }
      applySubmittedAction(state.selected, pos);
    },

    chooseDefender: (pos) => applyStoreCommand({ type: "ChooseDefender", position: pos }),
    cancelDefenderSelection: () => applyStoreCommand({ type: "CancelDefendedKing" }),
    activateTransform: (pos) => applyStoreCommand({ type: "ActivateTransform", position: pos }),
    chooseTransform: (newType) => applyStoreCommand({ type: "ChooseTransform", newType }),
    declineTransform: () => applyStoreCommand({ type: "DeclineTransform" }),
    passTurn: () => applyStoreCommand({ type: "PassTurn" }),

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
        const { player, pieceType } = state.currentPlacement;
        const position = chooseQuickPlacementSquare(state.board, player, pieceType);
        applyStoreCommand({ type: "PlacePiece", position });
        return;
      }
      if (state.phase.phase === "transformSelection") {
        if (state.pendingTransform?.owner !== state.aiPlayer) return;
        const options = ["AttackPawn", "DefensePawn", "ConquestPawn"].filter((item) => item !== state.pendingTransform?.pieceType) as Array<
          "AttackPawn" | "DefensePawn" | "ConquestPawn"
        >;
        state.chooseTransform(options[0]);
        return;
      }
      if (state.phase.phase === "defenderSelection") {
        if (state.pendingDefendedKing?.owner !== state.aiPlayer) return;
        state.chooseDefender(state.pendingDefendedKing.defenders[0]);
        return;
      }
      if (state.currentPlayer !== state.aiPlayer || state.phase.phase !== "playing") return;
      const transform = getTransformEligibility(toCoreMatchState(state));
      if (transform) {
        state.activateTransform(transform.pos);
        return;
      }
      const action = chooseDeterministicAction(state.board, state.currentPlayer, state.movesThisTurn, state.kingMoved, state.rulesVersion);
      if (action.kind === "pass") {
        state.passTurn();
        return;
      }
      if (!action.start || !action.end) return;
      applySubmittedAction(action.start, action.end, state.aiPlayer, action.selectedRouteId ?? undefined);
    },

    startClock: (now) => {
      const state = get();
      if (!state.matchConfig || state.matchConfig.timerSeconds === 0 || state.phase.phase !== "playing") return;
      if (state.aiEnabled && state.currentPlayer === state.aiPlayer) return;
      syncClock(now, true);
      const latest = get();
      if (latest.phase.phase === "gameOver") return;
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
      if (!restoreSavedGame(saved, "Imported save loaded.")) return false;
      try {
        if (localStorageAvailable()) window.localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
      } catch {
        set({ message: "Imported save loaded, but could not be written to local storage." });
      }
      return true;
    },
  };
});
