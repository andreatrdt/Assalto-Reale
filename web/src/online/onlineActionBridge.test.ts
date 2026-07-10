import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "../game/state/gameStore";
import {
  installOnlineGameActionBridge,
  restoreLocalGameActions,
} from "./onlineActionBridge";
import { useOnlineMatchStore } from "./onlineStore";

beforeEach(() => {
  restoreLocalGameActions();
  useOnlineMatchStore.setState({
    connectionStatus: "offline",
    connectionDetail: null,
    matchId: "match_bridge01",
    side: "Black",
    waitingForOpponent: false,
    pendingCommandId: null,
    completed: false,
    lastError: null,
  });
  useGameStore.setState({ message: "Ready" });
});

afterEach(() => {
  restoreLocalGameActions();
  useOnlineMatchStore.setState({
    connectionStatus: "idle",
    matchId: null,
    side: null,
    waitingForOpponent: false,
    pendingCommandId: null,
    completed: false,
    lastError: null,
  });
});

describe("online action bridge", () => {
  it("blocks board interaction while disconnected and restores local actions", () => {
    const localActivate = useGameStore.getState().activateSquare;
    installOnlineGameActionBridge();

    expect(useGameStore.getState().activateSquare).not.toBe(localActivate);
    useGameStore.getState().activateSquare([0, 0]);
    expect(useGameStore.getState().message).toBe(
      "Reconnecting to the online match…",
    );

    restoreLocalGameActions();
    expect(useGameStore.getState().activateSquare).toBe(localActivate);
  });

  it("prevents local persistence and undo from becoming online authority", () => {
    installOnlineGameActionBridge();

    useGameStore.getState().undo();
    expect(useGameStore.getState().message).toBe(
      "This action is unavailable during an online match.",
    );
    expect(useGameStore.getState().exportSaveJson()).toBeNull();
    expect(useGameStore.getState().importSaveJson("{}")).toBe(false);
  });
});
