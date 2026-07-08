import { create } from "zustand";
import type { PhaseState } from "../../app/phases";
import { chooseDeterministicAction } from "../ai/search";
import {
  adjacentDefendersForKing,
  assignGeneratedSpecialSquares,
  applyAction,
  buildAction,
  canPlacePiece,
  cloneBoard,
  createBoard,
  ensureTransformSquare,
  fromPythonSnapshot,
  getPiece,
  hasPos,
  nextPieceTypeFor,
  PAWN_TYPES,
  placePiece,
  refreshTerritoryClaim,
  toPythonSnapshot,
  transformPiece,
  updateControl,
  type Action,
  type BoardState,
  type DefendedKingPreview,
  type PawnType,
  type PieceType,
  type Player,
  type TransitionResult,
  type Vec2,
} from "../engine";
import { PLACEMENT_SCHEDULE } from "../engine/config";
import { DEFAULT_MATCH_CONFIG, createSetupSeed, resolveMatchConfig, type MatchConfig } from "../setup/matchConfig";

type PiecesLeft = Record<Player, Record<PieceType, number>>;
type PendingPlacement = { player: Player; pieceType: PieceType };
type PendingTransform = { pos: Vec2; player: Player; pieceType: PawnType; forceTurnSwitch: boolean };
type PendingDefendedKing = { action: Action; preview: DefendedKingPreview; defenders: Vec2[] };

interface HistoryEntry {
  board: BoardState;
  currentPlayer: Player;
  movesThisTurn: number;
  kingMoved: boolean;
  turnCounter: number;
  placementCursor: number;
  currentPlacement: PendingPlacement | null;
  piecesLeft: PiecesLeft;
  phase: PhaseState;
  lastAction: string;
  message: string;
  pendingTransform: PendingTransform | null;
  pendingDefendedKing: PendingDefendedKing | null;
}

interface StartMatchOptions {
  transformEnabled?: boolean;
  aiEnabled?: boolean;
  aiPlayer?: Player;
  seed?: number;
}

interface SavedGame {
  schema: 1;
  savedAt?: string;
  board: ReturnType<typeof toPythonSnapshot>;
  phase: PhaseState;
  currentPlayer: Player;
  movesThisTurn: number;
  kingMoved: boolean;
  turnCounter: number;
  placementCursor: number;
  currentPlacement: PendingPlacement | null;
  piecesLeft: PiecesLeft;
  lastAction: string;
  message: string;
  aiEnabled: boolean;
  aiPlayer: Player;
  hasActiveMatch: boolean;
  matchConfig: MatchConfig | null;
  timeLeft: Record<Player, number>;
}

interface GameStore {
  phase: PhaseState;
  board: BoardState;
  currentPlayer: Player;
  movesThisTurn: number;
  kingMoved: boolean;
  turnCounter: number;
  selected: Vec2 | null;
  legalTargets: Vec2[];
  placementCursor: number;
  currentPlacement: PendingPlacement | null;
  piecesLeft: PiecesLeft;
  lastAction: string;
  message: string;
  history: HistoryEntry[];
  pendingTransform: PendingTransform | null;
  pendingDefendedKing: PendingDefendedKing | null;
  aiEnabled: boolean;
  aiPlayer: Player;
  hasActiveMatch: boolean;
  matchConfig: MatchConfig | null;
  timeLeft: Record<Player, number>;
  startConfiguredMatch: (config: MatchConfig) => void;
  startQuickMatch: (options?: StartMatchOptions) => void;
  startManualPlacement: (options?: StartMatchOptions) => void;
  startAiMatch: () => void;
  startTransformMatch: () => void;
  openRules: () => void;
  returnHome: () => void;
  activateSquare: (pos: Vec2) => void;
  chooseDefender: (pos: Vec2) => void;
  cancelDefenderSelection: () => void;
  chooseTransform: (newType: PawnType) => void;
  passTurn: () => void;
  undo: () => void;
  runAiTurn: () => void;
  saveGame: () => void;
  loadGame: () => void;
}

function createInitialPiecesLeft(): PiecesLeft {
  return {
    Black: { King: 1, AttackPawn: 4, DefensePawn: 4, ConquestPawn: 4 },
    White: { King: 1, AttackPawn: 4, DefensePawn: 4, ConquestPawn: 4 },
  };
}

function createEmptyPiecesLeft(): PiecesLeft {
  return {
    Black: { King: 0, AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0 },
    White: { King: 0, AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0 },
  };
}

function createBaseBoard(transformEnabled = false, seed = createSetupSeed()): BoardState {
  const board = createBoard({ transformEnabled });
  assignGeneratedSpecialSquares(board, seed);
  updateControl(board);
  return board;
}

function clonePiecesLeft(piecesLeft: PiecesLeft): PiecesLeft {
  return {
    Black: { ...piecesLeft.Black },
    White: { ...piecesLeft.White },
  };
}

function emptyHistoryEntry(state: GameStore): HistoryEntry {
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
  };
}

function placementQueue(): PendingPlacement[] {
  const remaining = createInitialPiecesLeft();
  const queue: PendingPlacement[] = [];
  for (const step of PLACEMENT_SCHEDULE) {
    for (let index = 0; index < step.count; index += 1) {
      const pieceType = nextPieceTypeFor(step.player, remaining);
      if (!pieceType) {
        throw new Error(`Placement queue overfilled ${step.player}`);
      }
      queue.push({ player: step.player, pieceType });
      remaining[step.player][pieceType] -= 1;
    }
  }
  return queue;
}

const QUEUE = placementQueue();

function findKing(board: BoardState, player: Player): Vec2 | null {
  for (let row = 0; row < board.config.rows; row += 1) {
    for (let col = 0; col < board.config.cols; col += 1) {
      const piece = board.grid[row][col];
      if (piece?.player === player && piece.type === "King") {
        return [row, col];
      }
    }
  }
  return null;
}

function chooseQuickPlacementSquare(board: BoardState, player: Player, pieceType: PieceType): Vec2 {
  const kingPos = findKing(board, player);
  const center = Math.floor(board.config.rows / 2);
  const anchor: Vec2 =
    pieceType === "King"
      ? [center, player === "Black" ? 2 : board.config.cols - 3]
      : pieceType === "AttackPawn"
        ? [center, player === "Black" ? 0 : board.config.cols - 1]
        : pieceType === "DefensePawn" && kingPos
          ? kingPos
          : pieceType === "ConquestPawn"
            ? [center, player === "Black" ? 2 : board.config.cols - 3]
            : [center, Math.floor(board.config.cols / 2)];

  let best: Vec2 | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let row = 0; row < board.config.rows; row += 1) {
    for (let col = 0; col < board.config.cols; col += 1) {
      const pos: Vec2 = [row, col];
      if (!canPlacePiece(board, pos, player, pieceType).ok) {
        continue;
      }
      let score = -2 * (Math.abs(row - anchor[0]) + Math.abs(col - anchor[1]));
      if (pieceType === "DefensePawn" && kingPos) {
        const d = Math.max(Math.abs(row - kingPos[0]), Math.abs(col - kingPos[1]));
        if (d === 1) score += 100;
        if (d === 2) score += 30;
      }
      if (pieceType === "ConquestPawn") {
        const d = Math.min(...board.specialSquares.map((special) => Math.max(Math.abs(row - special[0]), Math.abs(col - special[1]))));
        score += 60 / Math.max(1, d);
      }
      score += player === "White" ? col * 0.01 : -col * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = pos;
      }
    }
  }
  if (!best) {
    throw new Error(`No legal quick placement for ${player} ${pieceType}`);
  }
  return best;
}

function createQuickBalancedBoard(transformEnabled = false, seed = createSetupSeed()): BoardState {
  const board = createBaseBoard(transformEnabled, seed);
  for (const item of QUEUE) {
    const pos = chooseQuickPlacementSquare(board, item.player, item.pieceType);
    placePiece(board, pos, item.player, item.pieceType);
  }
  updateControl(board);
  return board;
}

function describePiece(pieceType: PieceType): string {
  return pieceType.replace("Pawn", " Pawn");
}

function actionTargets(board: BoardState, pos: Vec2, movesThisTurn: number, kingMoved: boolean): Vec2[] {
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

function switchPlayer(player: Player): Player {
  return player === "Black" ? "White" : "Black";
}

function squareName(pos: Vec2): string {
  return `${String.fromCharCode("A".charCodeAt(0) + pos[1])}${12 - pos[0]}`;
}

function defenderPositions(board: BoardState, action: Action): Vec2[] {
  if (!action.end) return [];
  const king = getPiece(board, action.end);
  return king ? adjacentDefendersForKing(board, action.end, king.player) : [];
}

function transformOptions(pieceType: PawnType): PawnType[] {
  return PAWN_TYPES.filter((item) => item !== pieceType);
}

function describeAction(action: Action, end: Vec2): string {
  if (action.defendedKing) {
    return `${action.player} attacked a defended King; Attack Pawn bounced to ${squareName(action.defendedKing.landingPosition)}.`;
  }
  if (action.kind === "capture") {
    return `${action.player} captured ${describePiece(action.capturedPieceType ?? "King")} on ${squareName(end)}.`;
  }
  return `${action.player} moved to ${squareName(end)}.`;
}

function transformEvent(result: TransitionResult): PendingTransform | null {
  const event = result.events.find((item) => item.kind === "transform_available");
  if (!event) return null;
  return {
    pos: event.data.at as Vec2,
    player: event.data.player as Player,
    pieceType: event.data.piece_type as PawnType,
    forceTurnSwitch: false,
  };
}

function advanceHalfTurn(board: BoardState, state: GameStore): { currentPlayer: Player; turnCounter: number; victory: TransitionResult["victory"] } {
  const turnCounter = state.turnCounter + 1;
  ensureTransformSquare(board, turnCounter, turnCounter);
  const victory = refreshTerritoryClaim(board, turnCounter);
  return { currentPlayer: switchPlayer(state.currentPlayer), turnCounter, victory };
}

function savedGameFromState(state: GameStore): SavedGame {
  return {
    schema: 1,
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
  };
}

function loadSavedGame(raw: string): SavedGame | null {
  try {
    const parsed = JSON.parse(raw) as SavedGame;
    return parsed.schema === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function localStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function initialTimeLeft(seconds: number): Record<Player, number> {
  return { Black: seconds, White: seconds };
}

export const useGameStore = create<GameStore>((set, get) => {
  function commitAction(action: Action, state: GameStore): void {
    const { board, result } = applyAction(state.board, action, {
      movesThisTurn: state.movesThisTurn,
      kingMoved: state.kingMoved,
    });
    if (result.error) {
      set({ message: result.error, selected: null, legalTargets: [] });
      return;
    }

    let currentPlayer = state.currentPlayer;
    let turnCounter = state.turnCounter;
    let victory = result.victory;
    let pendingTransform = transformEvent(result);
    let message = result.victory ? `${result.victory.winner} wins by ${result.victory.reason}.` : `${currentPlayer} to move.`;

    if (result.endsTurn) {
      const advanced = advanceHalfTurn(board, state);
      currentPlayer = advanced.currentPlayer;
      turnCounter = advanced.turnCounter;
      victory ??= advanced.victory;
      message = `${currentPlayer} to move.`;
    }

    if (pendingTransform) {
      pendingTransform = { ...pendingTransform, forceTurnSwitch: !result.endsTurn };
      message = `${pendingTransform.player}: choose a Transform for ${describePiece(pendingTransform.pieceType)} on ${squareName(pendingTransform.pos)}.`;
    }

    const lastAction = describeAction(action, action.defendedKing?.landingPosition ?? action.end ?? [0, 0]);
    const nextPhase = victory
      ? { phase: "gameOver", previousPhase: "playing" }
      : pendingTransform
        ? { phase: "transformSelection", previousPhase: "playing" }
        : state.phase.phase === "defenderSelection"
          ? { phase: "playing", previousPhase: "defenderSelection" }
          : state.phase;
    set({
      board,
      currentPlayer,
      movesThisTurn: result.endsTurn ? 0 : result.nextMovesThisTurn,
      kingMoved: result.endsTurn ? false : result.nextKingMoved,
      turnCounter,
      selected: null,
      legalTargets: [],
      pendingTransform,
      pendingDefendedKing: null,
      phase: nextPhase as PhaseState,
      history: [...state.history, emptyHistoryEntry(state)],
      lastAction,
      message: victory ? `${victory.winner} wins by ${victory.reason}.` : message,
    });
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
          placementCursor: QUEUE.length,
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
          lastAction: "Quick Balanced deployment complete.",
          message: "Black to move.",
        });
        return;
      }

      const first = QUEUE[0];
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
        placementCursor: QUEUE.length,
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
        lastAction: "Quick Balanced deployment complete.",
        message: "Black to move.",
      });
    },

    startAiMatch: () => get().startQuickMatch({ aiEnabled: true }),
    startTransformMatch: () => get().startQuickMatch({ transformEnabled: true }),

    startManualPlacement: (options = {}) => {
      const first = QUEUE[0];
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
        const item = QUEUE[state.placementCursor];
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
        const nextItem = QUEUE[nextCursor];
        updateControl(board);
        set({
          board,
          piecesLeft,
          placementCursor: nextCursor,
          currentPlacement: nextItem ?? null,
          currentPlayer: nextItem?.player ?? "Black",
          phase: nextItem ? state.phase : { phase: "playing", previousPhase: "placement" },
          history: [...state.history, emptyHistoryEntry(state)],
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
          pendingDefendedKing: { action, preview: action.defendedKing, defenders },
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
        phase: victory ? { phase: "gameOver", previousPhase: "transformSelection" } : { phase: "playing", previousPhase: "transformSelection" },
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
        history: [...state.history, emptyHistoryEntry(state)],
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
      set({
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
        pendingTransform: previous.pendingTransform,
        pendingDefendedKing: previous.pendingDefendedKing,
        selected: null,
        legalTargets: [],
        history: state.history.slice(0, -1),
      });
    },

    runAiTurn: () => {
      const state = get();
      if (!state.aiEnabled) return;
      if (state.phase.phase === "placement" && state.currentPlacement?.player === state.aiPlayer) {
        const item = QUEUE[state.placementCursor];
        if (!item) return;
        const pos = chooseQuickPlacementSquare(state.board, item.player, item.pieceType);
        const board = cloneBoard(state.board);
        placePiece(board, pos, item.player, item.pieceType);
        const piecesLeft = clonePiecesLeft(state.piecesLeft);
        piecesLeft[item.player][item.pieceType] -= 1;
        const nextCursor = state.placementCursor + 1;
        const nextItem = QUEUE[nextCursor];
        updateControl(board);
        set({
          board,
          piecesLeft,
          placementCursor: nextCursor,
          currentPlacement: nextItem ?? null,
          currentPlayer: nextItem?.player ?? "Black",
          phase: nextItem ? state.phase : { phase: "playing", previousPhase: "placement" },
          history: [...state.history, emptyHistoryEntry(state)],
          lastAction: `${item.player} placed ${describePiece(item.pieceType)} on ${squareName(pos)}.`,
          message: nextItem ? `${nextItem.player}: place ${describePiece(nextItem.pieceType)}.` : "Deployment complete. Black to move.",
        });
        return;
      }
      if (state.currentPlayer !== state.aiPlayer) return;
      if (state.phase.phase === "transformSelection" && state.pendingTransform?.player === state.aiPlayer) {
        const options = transformOptions(state.pendingTransform.pieceType);
        state.chooseTransform(options[0]);
        return;
      }
      if (state.phase.phase === "defenderSelection" && state.pendingDefendedKing) {
        state.chooseDefender(state.pendingDefendedKing.defenders[0]);
        return;
      }
      if (state.phase.phase !== "playing") return;
      const action = chooseDeterministicAction(state.board, state.currentPlayer, state.movesThisTurn, state.kingMoved);
      if (action.kind === "pass") {
        state.passTurn();
        return;
      }
      if (action.defendedKing && !action.selectedDefender) {
        const defenders = defenderPositions(state.board, action);
        commitAction({ ...action, selectedDefender: defenders[0] }, state);
        return;
      }
      commitAction(action, state);
    },

    saveGame: () => {
      const state = get();
      if (!localStorageAvailable()) {
        set({ message: "Save is not available in this environment." });
        return;
      }
      window.localStorage.setItem("assalto-reale-save", JSON.stringify(savedGameFromState(state)));
      set({ message: "Game saved locally." });
    },

    loadGame: () => {
      if (!localStorageAvailable()) {
        set({ message: "Load is not available in this environment." });
        return;
      }
      const saved = loadSavedGame(window.localStorage.getItem("assalto-reale-save") ?? "");
      if (!saved) {
        set({ message: "No valid local save found." });
        return;
      }
      set({
        board: fromPythonSnapshot(saved.board),
        phase: saved.phase,
        currentPlayer: saved.currentPlayer,
        movesThisTurn: saved.movesThisTurn,
        kingMoved: saved.kingMoved,
        turnCounter: saved.turnCounter,
        placementCursor: saved.placementCursor,
        currentPlacement: saved.currentPlacement,
        piecesLeft: clonePiecesLeft(saved.piecesLeft),
        lastAction: saved.lastAction,
        message: "Game loaded.",
        aiEnabled: saved.aiEnabled,
        aiPlayer: saved.aiPlayer,
        hasActiveMatch: saved.hasActiveMatch ?? true,
        matchConfig: saved.matchConfig ?? null,
        timeLeft: saved.timeLeft ?? initialTimeLeft(DEFAULT_MATCH_CONFIG.timerSeconds),
        selected: null,
        legalTargets: [],
        pendingTransform: null,
        pendingDefendedKing: null,
        history: [],
      });
    },
  };
});
