import { create } from "zustand";
import type { PhaseState } from "../../app/phases";
import { createBoard, placePiece, updateControl, type BoardState } from "../engine";

interface GameStore {
  phase: PhaseState;
  board: BoardState;
  startQuickMatch: () => void;
  openRules: () => void;
  returnHome: () => void;
}

function createPreviewBoard(): BoardState {
  const board = createBoard();
  board.specialSquares = [
    [2, 4],
    [3, 8],
    [6, 5],
    [8, 3],
    [9, 8],
  ];
  placePiece(board, [5, 2], "Black", "King");
  placePiece(board, [5, 3], "Black", "DefensePawn");
  placePiece(board, [4, 1], "Black", "AttackPawn");
  placePiece(board, [7, 5], "Black", "ConquestPawn");
  placePiece(board, [5, 9], "White", "King");
  placePiece(board, [5, 8], "White", "DefensePawn");
  placePiece(board, [4, 10], "White", "AttackPawn");
  placePiece(board, [3, 8], "White", "ConquestPawn");
  board.transformSquares = [[6, 8]];
  updateControl(board);
  return board;
}

export const useGameStore = create<GameStore>((set) => ({
  phase: { phase: "home" },
  board: createPreviewBoard(),
  startQuickMatch: () => set({ phase: { phase: "playing", previousPhase: "home" }, board: createPreviewBoard() }),
  openRules: () => set((state) => ({ phase: { phase: "rules", previousPhase: state.phase.phase } })),
  returnHome: () => set({ phase: { phase: "home" } }),
}));
