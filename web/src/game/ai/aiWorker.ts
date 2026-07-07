import type { BoardState, Player } from "../engine";
import { chooseDeterministicAction } from "./search";

export interface AiRequest {
  id: string;
  board: BoardState;
  player: Player;
  movesThisTurn: number;
}

self.onmessage = (event: MessageEvent<AiRequest>) => {
  const { id, board, player, movesThisTurn } = event.data;
  const action = chooseDeterministicAction(board, player, movesThisTurn);
  self.postMessage({ id, action });
};
