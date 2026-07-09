import type { Player } from "../game/engine";

export interface VictoryOutcome {
  winner: Player;
  reasonKey: "king_capture" | "territory" | "timeout";
  sentence: string;
}

/**
 * Formats the canonical victory message ("{Winner} wins by {reason}.") into a
 * readable sentence. Pure and deterministic so the victory presentation never
 * hard-codes or misreports an outcome.
 */
export function describeOutcome(message: string): VictoryOutcome {
  const winner: Player = message.startsWith("White") ? "White" : "Black";
  const lower = message.toLowerCase();
  if (lower.includes("territory")) {
    return { winner, reasonKey: "territory", sentence: `${winner} wins by controlling the Special Squares.` };
  }
  if (lower.includes("timeout")) {
    return { winner, reasonKey: "timeout", sentence: `${winner} wins on time.` };
  }
  return { winner, reasonKey: "king_capture", sentence: `${winner} wins by capturing the King.` };
}
