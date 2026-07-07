import { buildAction, type Action, type BoardState, type Player } from "../engine";
import { scoreAction } from "./evaluation";

export function legalActions(board: BoardState, player: Player, movesThisTurn = 0, kingMoved = false): Action[] {
  const actions: Action[] = [];
  for (let row = 0; row < board.config.rows; row += 1) {
    for (let col = 0; col < board.config.cols; col += 1) {
      const piece = board.grid[row][col];
      if (!piece || piece.player !== player) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          if (dr === 0 && dc === 0) {
            continue;
          }
          const action = buildAction(board, [row, col], [row + dr, col + dc], { movesThisTurn, kingMoved });
          if (!action.error) {
            actions.push(action);
          }
        }
      }
    }
  }
  actions.push({ kind: "pass", player, cost: 0, capture: false, endsTurn: true });
  return actions;
}

export function chooseDeterministicAction(board: BoardState, player: Player, movesThisTurn = 0, kingMoved = false): Action {
  const actions = legalActions(board, player, movesThisTurn, kingMoved);
  return actions.sort((a, b) => scoreAction(b) - scoreAction(a))[0];
}
