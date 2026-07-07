export type GamePhase =
  | "boot"
  | "home"
  | "setup"
  | "placement"
  | "playing"
  | "defendedKingPreview"
  | "defenderSelection"
  | "transformSelection"
  | "paused"
  | "rules"
  | "settings"
  | "gameOver"
  | "error";

export interface PhaseState {
  phase: GamePhase;
  previousPhase?: GamePhase;
  message?: string;
}
