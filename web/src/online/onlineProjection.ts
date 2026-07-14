import { deserializeState, type Player } from "../game/engine";
import { initialTimeLeft } from "../game/clocks/clockController";
import { storePatchFromCoreMatch } from "../game/core/matchAdapter";
import { DEFAULT_MATCH_CONFIG } from "../game/setup/matchConfig";
import { useGameStore } from "../game/state/gameStore";
import type { ResolvedDefendedKing } from "../game/state/storeTypes";
import type { CanonicalMatchSnapshot } from "./protocol";

export interface OnlineSnapshotOptions {
  message: string;
  side: Player | null;
  ended?: boolean;
  resolvedDefendedKing?: ResolvedDefendedKing | null;
}

export function applyOnlineSnapshot(snapshot: CanonicalMatchSnapshot, options: OnlineSnapshotOptions): boolean {
  const match = deserializeState(JSON.stringify(snapshot));
  if (!match) return false;

  const previousPhase = useGameStore.getState().phase.phase;
  const patch = storePatchFromCoreMatch(match, previousPhase);
  useGameStore.setState({
    ...patch,
    ...(options.ended ? { phase: { phase: "gameOver", previousPhase: match.phase } as const } : {}),
    aiEnabled: false,
    aiPlayer: "White",
    hasActiveMatch: !options.ended,
    matchConfig: {
      ...DEFAULT_MATCH_CONFIG,
      opponent: "Human",
      humanSide: options.side ?? "Random",
      resolvedHumanSide: null,
      aiSide: null,
      timerSeconds: 0,
      // Online matches always use manual placement; the label is Manual whether
      // the projected snapshot is still in placement or already in play.
      placementMode: "Manual",
      transformEnabled: match.board.transformSquares.length > 0,
      setupSeed: 0,
    },
    timeLeft: initialTimeLeft(0),
    clockRunningFor: null,
    clockLastSyncMs: null,
    resolvedDefendedKing: options.resolvedDefendedKing ?? null,
    lastAction: options.message,
    message: options.message,
  });
  return true;
}

export function clearOnlineProjection(): void {
  useGameStore.setState({
    hasActiveMatch: false,
    selected: null,
    legalTargets: [],
    history: [],
    pendingDefendedKing: null,
    projectedDefendedKing: null,
    resolvedDefendedKing: null,
    pendingTransform: null,
    clockRunningFor: null,
    clockLastSyncMs: null,
    message: "Choose a match flow.",
  });
}
