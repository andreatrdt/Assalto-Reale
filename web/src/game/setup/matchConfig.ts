import type { Player } from "../engine";

export type OpponentMode = "Human" | "Computer";
export type HumanSideChoice = Player | "Random";
export type AiDifficulty = "Easy" | "Medium" | "Hard";
export type TimerSeconds = 0 | 300 | 600 | 720 | 900 | 1200;
// Every product match uses "Manual". "QuickBalanced" is legacy/internal only —
// retained so already-persisted saves and canonical snapshots still type-check on
// load; nothing in the app creates it. See docs/current-product-status.md.
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

/**
 * Builds the configuration for a match created from the public Setup page.
 *
 * Every match always uses manual placement and always enables Transform; these
 * are not user-facing toggles. The AI difficulty is kept (from the default) so
 * the AI stays internally configured even though it is not shown publicly.
 */
export function createPublicMatchConfig(input: {
  opponent: OpponentMode;
  humanSide: HumanSideChoice;
  timerSeconds: TimerSeconds;
}): MatchConfig {
  return {
    ...DEFAULT_MATCH_CONFIG,
    opponent: input.opponent,
    humanSide: input.humanSide,
    timerSeconds: input.timerSeconds,
    placementMode: "Manual",
    transformEnabled: true,
  };
}

export function oppositePlayer(player: Player): Player {
  return player === "Black" ? "White" : "Black";
}

export function createSetupSeed(): number {
  const time = Date.now() & 0x7fffffff;
  const random = Math.floor(Math.random() * 0x7fffffff);
  return (time ^ random) >>> 0;
}

function seededSide(seed: number): Player {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) % 2 === 0 ? "Black" : "White";
}

export function resolveMatchConfig(config: MatchConfig): MatchConfig {
  const setupSeed = config.setupSeed ?? createSetupSeed();
  if (config.opponent === "Human") {
    return {
      ...config,
      resolvedHumanSide: null,
      aiSide: null,
      setupSeed,
    };
  }

  const resolvedHumanSide: Player = config.humanSide === "Random" ? seededSide(setupSeed) : config.humanSide;

  return {
    ...config,
    resolvedHumanSide,
    aiSide: oppositePlayer(resolvedHumanSide),
    setupSeed,
  };
}
