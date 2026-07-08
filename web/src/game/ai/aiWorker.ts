import type { BoardState, Player } from "../engine";
import { chooseDeterministicAction } from "./search";

export interface AiRequest {
  id: string;
  board: BoardState;
  player: Player;
  movesThisTurn: number;
  kingMoved: boolean;
}

self.onmessage = (event: MessageEvent<AiRequest>) => {
  const { id, board, player, movesThisTurn, kingMoved } = event.data;
  const action = chooseDeterministicAction(board, player, movesThisTurn, kingMoved);
  self.postMessage({ id, action });
};
