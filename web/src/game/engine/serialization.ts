import { createBoard } from "./board";
import { updateControl } from "./territory";
import type { BoardState, Piece, Player, Vec2 } from "./types";

type PythonPiece = Piece | null;

export interface PythonBoardSnapshot {
  config: {
    rows: number;
    cols: number;
    special_count: number;
    transform_enabled: boolean;
    transform_round: number;
  };
  grid: PythonPiece[][];
  special_squares: Vec2[];
  transform_squares: Vec2[];
  controlled_squares?: Record<Player, Vec2[]>;
  captured_pieces?: BoardState["capturedPieces"];
  territory_claim?: {
    claimant: Player;
    created_turn: number;
    mature_turn: number;
  } | null;
}

export function fromPythonSnapshot(snapshot: PythonBoardSnapshot): BoardState {
  const board = createBoard({
    rows: snapshot.config.rows,
    cols: snapshot.config.cols,
    specialCount: snapshot.config.special_count,
    transformEnabled: snapshot.config.transform_enabled,
    transformRound: snapshot.config.transform_round,
  });
  board.grid = snapshot.grid.map((row) => row.map((piece) => (piece ? { ...piece } : null)));
  board.specialSquares = snapshot.special_squares.map((pos) => [pos[0], pos[1]]);
  board.transformSquares = snapshot.transform_squares.map((pos) => [pos[0], pos[1]]);
  if (snapshot.captured_pieces) {
    board.capturedPieces = {
      Black: { ...snapshot.captured_pieces.Black },
      White: { ...snapshot.captured_pieces.White },
    };
  }
  board.territoryClaim = snapshot.territory_claim
    ? {
        claimant: snapshot.territory_claim.claimant,
        createdTurn: snapshot.territory_claim.created_turn,
        matureTurn: snapshot.territory_claim.mature_turn,
      }
    : null;
  updateControl(board);
  return board;
}

export function toPythonSnapshot(board: BoardState): PythonBoardSnapshot {
  return {
    config: {
      rows: board.config.rows,
      cols: board.config.cols,
      special_count: board.config.specialCount,
      transform_enabled: board.config.transformEnabled,
      transform_round: board.config.transformRound,
    },
    grid: board.grid.map((row) => row.map((piece) => (piece ? { ...piece } : null))),
    special_squares: board.specialSquares.map((pos) => [pos[0], pos[1]]),
    transform_squares: board.transformSquares.map((pos) => [pos[0], pos[1]]),
    controlled_squares: board.controlledSquares,
    captured_pieces: board.capturedPieces,
    territory_claim: board.territoryClaim
      ? {
          claimant: board.territoryClaim.claimant,
          created_turn: board.territoryClaim.createdTurn,
          mature_turn: board.territoryClaim.matureTurn,
        }
      : null,
  };
}
