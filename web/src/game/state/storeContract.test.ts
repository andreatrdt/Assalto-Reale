import { describe, expect, it } from "vitest";
import { useGameStore } from "./gameStore";

// Public-contract freeze. This guards the decomposition: the Zustand store must
// keep exactly these state fields and action names with the same runtime shape,
// so React components and existing tests need no changes. It intentionally
// asserts the public surface only, not private helper/module names.

const STATE_FIELDS = [
  "phase",
  "board",
  "currentPlayer",
  "movesThisTurn",
  "kingMoved",
  "turnCounter",
  "selected",
  "legalTargets",
  "placementCursor",
  "currentPlacement",
  "piecesLeft",
  "lastAction",
  "message",
  "history",
  "pendingTransform",
  "pendingDefendedKing",
  "aiEnabled",
  "aiPlayer",
  "hasActiveMatch",
  "matchConfig",
  "timeLeft",
  "clockRunningFor",
  "clockLastSyncMs",
] as const;

const ACTIONS = [
  "startConfiguredMatch",
  "startQuickMatch",
  "startManualPlacement",
  "startAiMatch",
  "startTransformMatch",
  "openRules",
  "returnHome",
  "activateSquare",
  "chooseDefender",
  "cancelDefenderSelection",
  "chooseTransform",
  "passTurn",
  "undo",
  "runAiTurn",
  "startClock",
  "stopClock",
  "tickClock",
  "saveGame",
  "loadGame",
  "exportSaveJson",
  "importSaveJson",
] as const;

describe("game store public contract", () => {
  it("exposes exactly the expected state fields and actions", () => {
    const state = useGameStore.getState();
    const keys = Object.keys(state).sort();
    expect(keys).toEqual([...STATE_FIELDS, ...ACTIONS].sort());
  });

  it("keeps every action a callable function", () => {
    const state = useGameStore.getState();
    for (const action of ACTIONS) {
      expect(typeof state[action], action).toBe("function");
    }
  });

  it("returns the documented save-export shape", () => {
    const json = useGameStore.getState().exportSaveJson();
    expect(typeof json === "string" || json === null).toBe(true);
  });
});
