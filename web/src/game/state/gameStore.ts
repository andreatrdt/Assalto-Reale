import { create } from "zustand";
import type { PhaseState } from "../../app/phases";
import {
  applyAction,
  buildAction,
  canPlacePiece,
  cloneBoard,
  createBoard,
  getPiece,
  hasPos,
  nextPieceTypeFor,
  placePiece,
  updateControl,
  type Action,
  type BoardState,
  type PieceType,
  type Player,
  type Vec2,
} from "../engine";
import { PLACEMENT_SCHEDULE } from "../engine/config";

type PiecesLeft = Record<Player, Record<PieceType, number>>;

interface HistoryEntry {
  board: BoardState;
  currentPlayer: Player;
  movesThisTurn: number;
  kingMoved: boolean;
  placementCursor: number;
  currentPlacement: { player: Player; pieceType: PieceType } | null;
  piecesLeft: PiecesLeft;
  phase: PhaseState;
  lastAction: string;
}

interface GameStore {
  phase: PhaseState;
  board: BoardState;
  currentPlayer: Player;
  movesThisTurn: number;
  kingMoved: boolean;
  selected: Vec2 | null;
  legalTargets: Vec2[];
  placementCursor: number;
  currentPlacement: { player: Player; pieceType: PieceType } | null;
  piecesLeft: PiecesLeft;
  lastAction: string;
  message: string;
  history: HistoryEntry[];
  startQuickMatch: () => void;
  startManualPlacement: () => void;
  openRules: () => void;
  returnHome: () => void;
  activateSquare: (pos: Vec2) => void;
  passTurn: () => void;
  undo: () => void;
}

function createInitialPiecesLeft(): PiecesLeft {
  return {
    Black: { King: 1, AttackPawn: 4, DefensePawn: 4, ConquestPawn: 4 },
    White: { King: 1, AttackPawn: 4, DefensePawn: 4, ConquestPawn: 4 },
  };
}

function createBaseBoard(): BoardState {
  const board = createBoard();
  board.specialSquares = [
    [2, 4],
    [3, 8],
    [6, 5],
    [8, 3],
    [9, 8],
  ];
  updateControl(board);
  return board;
}

function emptyHistoryEntry(state: GameStore): HistoryEntry {
  return {
    board: cloneBoard(state.board),
    currentPlayer: state.currentPlayer,
    movesThisTurn: state.movesThisTurn,
    kingMoved: state.kingMoved,
    placementCursor: state.placementCursor,
    currentPlacement: state.currentPlacement,
    piecesLeft: clonePiecesLeft(state.piecesLeft),
    phase: { ...state.phase },
    lastAction: state.lastAction,
  };
}

function clonePiecesLeft(piecesLeft: PiecesLeft): PiecesLeft {
  return {
    Black: { ...piecesLeft.Black },
    White: { ...piecesLeft.White },
  };
}

function placementQueue(): Array<{ player: Player; pieceType: PieceType }> {
  const remaining: PiecesLeft = createInitialPiecesLeft();
  const queue: Array<{ player: Player; pieceType: PieceType }> = [];
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

function createQuickBalancedBoard(): BoardState {
  const board = createBaseBoard();
  for (const item of QUEUE) {
    const pos = chooseQuickPlacementSquare(board, item.player, item.pieceType);
    placePiece(board, pos, item.player, item.pieceType);
  }
  updateControl(board);
  return board;
}

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

export const useGameStore = create<GameStore>((set, get) => ({
  phase: { phase: "home" },
  board: createQuickBalancedBoard(),
  currentPlayer: "Black",
  movesThisTurn: 0,
  kingMoved: false,
  selected: null,
  legalTargets: [],
  placementCursor: 0,
  currentPlacement: null,
  piecesLeft: createInitialPiecesLeft(),
  lastAction: "Ready.",
  message: "Choose a match flow.",
  history: [],

  startQuickMatch: () => {
    set({
      phase: { phase: "playing", previousPhase: "home" },
      board: createQuickBalancedBoard(),
      currentPlayer: "Black",
      movesThisTurn: 0,
      kingMoved: false,
      selected: null,
      legalTargets: [],
      placementCursor: QUEUE.length,
      currentPlacement: null,
      piecesLeft: {
        Black: { King: 0, AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0 },
        White: { King: 0, AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0 },
      },
      history: [],
      lastAction: "Quick Balanced deployment complete.",
      message: "Black to move.",
    });
  },

  startManualPlacement: () => {
    const first = QUEUE[0];
    set({
      phase: { phase: "placement", previousPhase: "home" },
      board: createBaseBoard(),
      currentPlayer: first.player,
      movesThisTurn: 0,
      kingMoved: false,
      selected: null,
      legalTargets: [],
      placementCursor: 0,
      currentPlacement: first,
      piecesLeft: createInitialPiecesLeft(),
      history: [],
      lastAction: "Manual deployment started.",
      message: `${first.player}: place ${describePiece(first.pieceType)}.`,
    });
  },

  openRules: () => set((state) => ({ phase: { phase: "rules", previousPhase: state.phase.phase } })),
  returnHome: () => set({ phase: { phase: "home" }, selected: null, legalTargets: [], message: "Choose a match flow." }),

  activateSquare: (pos) => {
    const state = get();
    if (state.phase.phase === "placement") {
      const item = QUEUE[state.placementCursor];
      if (!item) return;
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
    const { board, result } = applyAction(state.board, action, {
      movesThisTurn: state.movesThisTurn,
      kingMoved: state.kingMoved,
    });
    const nextPlayer = result.endsTurn ? switchPlayer(state.currentPlayer) : state.currentPlayer;
    const lastAction = describeAction(action, pos);
    set({
      board,
      currentPlayer: nextPlayer,
      movesThisTurn: result.nextMovesThisTurn,
      kingMoved: result.nextKingMoved,
      selected: null,
      legalTargets: [],
      history: [...state.history, emptyHistoryEntry(state)],
      lastAction,
      message: result.victory ? `${result.victory.winner} wins by ${result.victory.reason}.` : `${nextPlayer} to move.`,
      phase: result.victory ? { phase: "gameOver", previousPhase: "playing" } : state.phase,
    });
  },

  passTurn: () => {
    const state = get();
    if (state.phase.phase !== "playing") return;
    const pass: Action = { kind: "pass", player: state.currentPlayer, cost: 0, capture: false, endsTurn: true };
    const { board } = applyAction(state.board, pass);
    const next = switchPlayer(state.currentPlayer);
    set({
      board,
      currentPlayer: next,
      movesThisTurn: 0,
      kingMoved: false,
      selected: null,
      legalTargets: [],
      history: [...state.history, emptyHistoryEntry(state)],
      lastAction: `${state.currentPlayer} passed.`,
      message: `${next} to move.`,
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
      placementCursor: previous.placementCursor,
      currentPlacement: QUEUE[previous.placementCursor] ?? null,
      piecesLeft: clonePiecesLeft(previous.piecesLeft),
      phase: previous.phase,
      lastAction: previous.lastAction,
      selected: null,
      legalTargets: [],
      history: state.history.slice(0, -1),
      message: "Undone.",
    });
  },
}));

function describeAction(action: Action, end: Vec2): string {
  if (action.kind === "capture") {
    return `${action.player} captured ${action.capturedPieceType ?? "piece"} on ${squareName(end)}.`;
  }
  return `${action.player} moved to ${squareName(end)}.`;
}
