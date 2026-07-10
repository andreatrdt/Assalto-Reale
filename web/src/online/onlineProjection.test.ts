import { afterEach, describe, expect, it } from "vitest";
import { createMatch, serializeState } from "../game/engine";
import { useGameStore } from "../game/state/gameStore";
import { applyOnlineSnapshot, clearOnlineProjection } from "./onlineProjection";
import type { CanonicalMatchSnapshot } from "./protocol";

function snapshot(placementMode: "Manual" | "QuickBalanced" = "QuickBalanced"): CanonicalMatchSnapshot {
  return JSON.parse(
    serializeState(
      createMatch({
        placementMode,
        transformEnabled: true,
        seed: 1234,
      }),
    ),
  ) as CanonicalMatchSnapshot;
}

afterEach(() => {
  clearOnlineProjection();
});

describe("canonical online projection", () => {
  it("projects a server snapshot into the existing board UI state", () => {
    expect(
      applyOnlineSnapshot(snapshot(), {
        message: "Online match synchronized.",
        side: "White",
      }),
    ).toBe(true);

    const state = useGameStore.getState();
    expect(state.hasActiveMatch).toBe(true);
    expect(state.phase.phase).toBe("playing");
    expect(state.currentPlayer).toBe("Black");
    expect(state.aiEnabled).toBe(false);
    expect(state.matchConfig).toMatchObject({
      opponent: "Human",
      humanSide: "White",
      timerSeconds: 0,
      transformEnabled: state.board.transformSquares.length > 0,
    });
    expect(state.message).toBe("Online match synchronized.");
  });

  it("projects manual placement and terminal state", () => {
    expect(
      applyOnlineSnapshot(snapshot("Manual"), {
        message: "Waiting for placement.",
        side: "Black",
        ended: true,
      }),
    ).toBe(true);

    const state = useGameStore.getState();
    expect(state.phase.phase).toBe("gameOver");
    expect(state.phase.previousPhase).toBe("placement");
    expect(state.matchConfig?.placementMode).toBe("Manual");
  });

  it("rejects malformed snapshots without mutating into an active match", () => {
    clearOnlineProjection();
    expect(
      applyOnlineSnapshot({ schema: 999 } as unknown as CanonicalMatchSnapshot, {
        message: "Invalid",
        side: null,
      }),
    ).toBe(false);
    expect(useGameStore.getState().hasActiveMatch).toBe(false);
  });

  it("clears projected selection, history and active-match flags", () => {
    applyOnlineSnapshot(snapshot(), { message: "Ready", side: "Black" });
    useGameStore.setState({ selected: [1, 1], legalTargets: [[1, 2]] });

    clearOnlineProjection();
    const state = useGameStore.getState();
    expect(state.hasActiveMatch).toBe(false);
    expect(state.selected).toBeNull();
    expect(state.legalTargets).toEqual([]);
    expect(state.message).toBe("Choose a match flow.");
  });
});
