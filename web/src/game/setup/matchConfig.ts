import type { Player } from "../engine";

export type OpponentMode = "Human" | "Computer";
export type HumanSideChoice = Player | "Random";
export type AiDifficulty = "Easy" | "Medium" | "Hard";
export type TimerSeconds = 0 | 300 | 600 | 720 | 900 | 1200;
export type PlacementMode = "Manual" | "QuickBalanced";

export interface MatchConfig {
  opponent: OpponentMode;
  humanSide: HumanSideChoice;
  resolvedHumanSide: Player | null;
  aiSide: Player | null;
  aiDifficulty: AiDifficulty;
  timerSeconds: TimerSeconds;
  placementMode: PlacementMode;
  transformEnabled: boolean;
  setupSeed?: number;
}

export const TIMER_PRESETS: { label: string; seconds: TimerSeconds }[] = [
  { label: "Untimed", seconds: 0 },
  { label: "5 minutes", seconds: 300 },
  { label: "10 minutes", seconds: 600 },
  { label: "12 minutes", seconds: 720 },
  { label: "15 minutes", seconds: 900 },
  { label: "20 minutes", seconds: 1200 },
];

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  opponent: "Human",
  humanSide: "Black",
  resolvedHumanSide: null,
  aiSide: null,
  aiDifficulty: "Medium",
  timerSeconds: 720,
  placementMode: "Manual",
  transformEnabled: false,
};

export function oppositePlayer(player: Player): Player {
  return player === "Black" ? "White" : "Black";
}

export function createSetupSeed(): number {
  const time = Date.now() & 0x7fffffff;
  const random = Math.floor(Math.random() * 0x7fffffff);
  return (time ^ random) >>> 0;
}

export function resolveMatchConfig(config: MatchConfig): MatchConfig {
  if (config.opponent === "Human") {
    return {
      ...config,
      resolvedHumanSide: null,
      aiSide: null,
      setupSeed: config.setupSeed ?? createSetupSeed(),
    };
  }

  const resolvedHumanSide: Player =
    config.humanSide === "Random" ? (Math.random() < 0.5 ? "Black" : "White") : config.humanSide;

  return {
    ...config,
    resolvedHumanSide,
    aiSide: oppositePlayer(resolvedHumanSide),
    setupSeed: config.setupSeed ?? createSetupSeed(),
  };
}
