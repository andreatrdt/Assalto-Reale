import type { Action, BoardState, Player } from "../engine";

const PIECE_VALUE = {
  King: 1000,
  AttackPawn: 45,
  DefensePawn: 55,
  ConquestPawn: 65,
};

export function evaluateBoard(board: BoardState, player: Player): number {
  let score = 0;
  for (const row of board.grid) {
    for (const piece of row) {
      if (!piece) {
        continue;
      }
      const value = PIECE_VALUE[piece.type];
      score += piece.player === player ? value : -value;
    }
  }
  score += board.controlledSquares[player].length * 120;
  return score;
}

export function scoreAction(action: Action): number {
  if (action.kind === "pass") {
    return -10;
  }
  if (action.capture) {
    return 100 + (action.capturedPieceType ? PIECE_VALUE[action.capturedPieceType] : 0);
  }
  return 1;
}
