import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingTransform, Vec2 } from "../game/engine";
import { useGameStore } from "../game/state/gameStore";
import { installOnlineGameActionBridge, restoreLocalGameActions } from "./onlineActionBridge";
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
    expect(useGameStore.getState().message).toBe("Reconnecting to the online match…");

    restoreLocalGameActions();
    expect(useGameStore.getState().activateSquare).toBe(localActivate);
  });

  it("routes a placement tap to the server during manual placement, and blocks the opponent's", () => {
    const placements: Vec2[] = [];
    useOnlineMatchStore.setState({
      connectionStatus: "connected",
      side: "Black",
      sendPlacement: (pos: Vec2): boolean => {
        placements.push(pos);
        return true;
      },
    });
    useGameStore.setState({
      phase: { phase: "placement" },
      currentPlacement: { player: "Black", pieceType: "King" },
    });
    installOnlineGameActionBridge();

    // It is Black's placement and this client is Black: the tap is sent as a
    // PlacePiece command (online matches now always go through placement).
    useGameStore.getState().activateSquare([0, 0]);
    expect(placements).toEqual([[0, 0]]);
    expect(useGameStore.getState().message).toBe("Confirming placement with the server…");

    // When it is the opponent's placement, the tap is blocked, not sent.
    useGameStore.setState({ currentPlacement: { player: "White", pieceType: "King" } });
    useGameStore.getState().activateSquare([1, 1]);
    expect(placements).toEqual([[0, 0]]);
    expect(useGameStore.getState().message).toBe("It is your opponent's placement.");
  });

  it("prevents local persistence and undo from becoming online authority", () => {
    installOnlineGameActionBridge();

    useGameStore.getState().undo();
    expect(useGameStore.getState().message).toBe("This action is unavailable during an online match.");
    expect(useGameStore.getState().exportSaveJson()).toBeNull();
    expect(useGameStore.getState().importSaveJson("{}")).toBe(false);
  });

  it("sends Transform choices without mutating the pending decision optimistically", () => {
    const chooseTransform = vi.fn(() => true);
    const declineTransform = vi.fn(() => true);
    const pendingTransform = {
      owner: "Black",
      player: "Black",
      pos: [5, 5] as Vec2,
      pieceType: "ConquestPawn" as const,
      forceTurnSwitch: false,
    } satisfies PendingTransform;
    useOnlineMatchStore.setState({
      connectionStatus: "connected",
      side: "Black",
      chooseTransform,
      declineTransform,
    });
    useGameStore.setState({ phase: { phase: "transformSelection" }, pendingTransform });
    installOnlineGameActionBridge();

    useGameStore.getState().chooseTransform("AttackPawn");
    expect(chooseTransform).toHaveBeenCalledWith("AttackPawn");
    expect(useGameStore.getState().pendingTransform).toEqual(pendingTransform);

    useGameStore.getState().declineTransform();
    expect(declineTransform).toHaveBeenCalledOnce();
    expect(useGameStore.getState().pendingTransform).toEqual(pendingTransform);
  });
});
