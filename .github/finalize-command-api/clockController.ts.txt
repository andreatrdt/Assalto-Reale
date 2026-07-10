// Clock arithmetic extracted from the store. `computeClockPatch` is pure: given
// the current state and a monotonic `now`, it returns the state patch to apply
// (decrement, timeout victory, or stop). The store owns the set/get wiring; this
// module owns the policy (inactive clocks never tick, terminal games freeze,
// untimed matches never time out, wall time is not deducted while unloaded).
import { opponent } from "../engine";
import type { Player } from "../engine";
import type { GameState, StatePatch } from "../state/storeTypes";

export function initialTimeLeft(seconds: number): Record<Player, number> {
  return { Black: seconds, White: seconds };
}

export function monotonicNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function computeClockPatch(state: GameState, now: number, stopRunning = false): StatePatch {
  const runningFor = state.clockRunningFor;
  if (!runningFor || state.clockLastSyncMs === null || state.phase.phase === "gameOver") {
    return stopRunning ? { clockRunningFor: null, clockLastSyncMs: null } : {};
  }

  const elapsedMs = Math.max(0, now - state.clockLastSyncMs);
  const remainingSeconds = state.timeLeft[runningFor];
  if (remainingSeconds <= 0 || elapsedMs >= remainingSeconds * 1000) {
    const winner = opponent(runningFor);
    return {
      timeLeft: { ...state.timeLeft, [runningFor]: 0 },
      phase: { phase: "gameOver", previousPhase: state.phase.phase },
      selected: null,
      legalTargets: [],
      pendingTransform: null,
      pendingDefendedKing: null,
      clockRunningFor: null,
      clockLastSyncMs: null,
      lastAction: `${runningFor} ran out of time.`,
      message: `${winner} wins by timeout.`,
    };
  }

  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  if (elapsedSeconds === 0) {
    return stopRunning ? { clockRunningFor: null, clockLastSyncMs: null } : {};
  }

  return {
    timeLeft: {
      ...state.timeLeft,
      [runningFor]: remainingSeconds - elapsedSeconds,
    },
    clockRunningFor: stopRunning ? null : runningFor,
    clockLastSyncMs: stopRunning ? null : state.clockLastSyncMs + elapsedSeconds * 1000,
  };
}
