import { PLAYERS } from "./config.js";
import { getPiece, sortPositions } from "./board.js";
import type { BoardState, Player, SpecialControl, VictoryResult } from "./types.js";

export function requiredSpecialMajority(board: BoardState): number {
  return Math.floor(board.specialSquares.length / 2) + 1;
}

export function updateControl(board: BoardState): Record<Player, Array<readonly [number, number]>> {
  const controlled: Record<Player, Array<readonly [number, number]>> = { Black: [], White: [] };
  for (const pos of board.specialSquares) {
    const piece = getPiece(board, pos);
    if (piece?.type === "ConquestPawn") {
      controlled[piece.player].push(pos);
    }
  }
  board.controlledSquares = {
    Black: sortPositions(controlled.Black.map((pos) => [pos[0], pos[1]])),
    White: sortPositions(controlled.White.map((pos) => [pos[0], pos[1]])),
  };
  return board.controlledSquares;
}

export function getSpecialControl(board: BoardState): SpecialControl {
  updateControl(board);
  return {
    controlled: board.controlledSquares,
    requiredMajority: requiredSpecialMajority(board),
    claim: board.territoryClaim,
  };
}

export function currentMajorityPlayer(board: BoardState): Player | null {
  updateControl(board);
  const required = requiredSpecialMajority(board);
  const winners = PLAYERS.filter((player) => board.controlledSquares[player].length >= required);
  return winners.length === 1 ? winners[0] : null;
}

export function refreshTerritoryClaim(board: BoardState, turnCounter: number): VictoryResult | null {
  const majority = currentMajorityPlayer(board);
  if (!majority) {
    board.territoryClaim = null;
    return null;
  }
  if (!board.territoryClaim || board.territoryClaim.claimant !== majority) {
    board.territoryClaim = {
      claimant: majority,
      createdTurn: turnCounter,
      matureTurn: turnCounter + 2,
    };
    return null;
  }
  if (turnCounter >= board.territoryClaim.matureTurn) {
    return { winner: majority, reason: "territory", loser: null };
  }
  return null;
}
