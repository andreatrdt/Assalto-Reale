import { PLAYERS } from "./config";
import { refreshTerritoryClaim } from "./territory";
import type { BoardState, Player, VictoryResult } from "./types";

export function opponent(player: Player): Player {
  return player === "Black" ? "White" : "Black";
}

export function evaluateVictory(
  board: BoardState,
  options: { lastActor?: Player; turnCounter?: number } = {},
): VictoryResult | null {
  const kings: Record<Player, boolean> = { Black: false, White: false };
  for (const row of board.grid) {
    for (const piece of row) {
      if (piece?.type === "King") {
        kings[piece.player] = true;
      }
    }
  }
  for (const player of PLAYERS) {
    if (!kings[player]) {
      return {
        winner: options.lastActor ?? opponent(player),
        reason: "king_capture",
        loser: player,
      };
    }
  }
  if (options.turnCounter !== undefined) {
    return refreshTerritoryClaim(board, options.turnCounter);
  }
  return null;
}
