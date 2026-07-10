import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEventEnvelope } from "./protocol";

const applyOnlineSnapshot = vi.fn(() => true);
const clearOnlineProjection = vi.fn();

interface MockClientOptions {
  onStatus(status: string, detail?: string): void;
  onEnvelope(envelope: ServerEventEnvelope): void;
}

class MockOnlineClient {
  static latest: MockOnlineClient | null = null;
  readonly send = vi.fn(() => `command_mock${this.send.mock.calls.length + 1}`);
  readonly setMatchContext = vi.fn();
  readonly disconnect = vi.fn();
  connectResult: Promise<{
    token: string;
    playerId: string;
    sessionId: string;
    expiresAt: string;
  }> = Promise.resolve({
    token: "token",
    playerId: "player_alice01",
    sessionId: "session_alice1",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });

  constructor(private readonly options: MockClientOptions) {
    MockOnlineClient.latest = this;
  }

  connect() {
    this.options.onStatus("connecting");
    return this.connectResult.then((principal) => {
      this.options.onStatus("connected");
      return principal;
    });
  }

  emit(envelope: ServerEventEnvelope): void {
    this.options.onEnvelope(envelope);
  }

  status(status: string, detail?: string): void {
    this.options.onStatus(status, detail);
  }
}

vi.mock("./onlineClient", () => ({
  OnlineClient: MockOnlineClient,
}));

vi.mock("./onlineIdentity", () => ({
  configuredWebSocketUrl: () => "ws://games.test/ws",
}));

vi.mock("./onlineProjection", () => ({
  applyOnlineSnapshot,
  clearOnlineProjection,
}));

import { useGameStore } from "../game/state/gameStore";
import { useOnlineMatchStore } from "./onlineStore";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const snapshot = { schema: 2 } as never;
let sequence = 0;

function envelope(
  event: ServerEventEnvelope["event"],
  overrides: Partial<ServerEventEnvelope> = {},
): ServerEventEnvelope {
  sequence += 1;
  return {
    protocol: "assalto-reale",
    protocolVersion: 1,
    messageType: "event",
    eventId: `event_${String(sequence).padStart(8, "0")}`,
    emittedAt: "2026-07-10T18:00:00.000Z",
    matchId: "match_online01",
    matchVersion: sequence,
    streamSequence: sequence,
    causationCommandId: null,
    recipient: "all",
    event,
    ...overrides,
  };
}

function resetStore(): void {
  useOnlineMatchStore.getState().disconnect(false);
  useOnlineMatchStore.setState({
    connectionStatus: "idle",
    connectionDetail: null,
    playerId: null,
    sessionId: null,
    matchId: null,
    inviteCode: null,
    side: null,
    matchVersion: null,
    streamSequence: null,
    waitingForOpponent: false,
    pendingCommandId: null,
    lastError: null,
    lastRejectionCode: null,
    winner: null,
    completed: false,
  });
  MockOnlineClient.latest = null;
  sequence = 0;
}

beforeEach(() => {
  vi.stubGlobal("window", { sessionStorage: memoryStorage() });
  resetStore();
  applyOnlineSnapshot.mockClear();
  clearOnlineProjection.mockClear();
});

afterEach(() => {
  resetStore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("online match store", () => {
  it("connects once and propagates connection lifecycle state", async () => {
    await expect(useOnlineMatchStore.getState().connect()).resolves.toBe(true);
    const client = MockOnlineClient.latest;
    expect(client).not.toBeNull();
    expect(useOnlineMatchStore.getState()).toMatchObject({
      connectionStatus: "connected",
      playerId: "player_alice01",
      sessionId: "session_alice1",
      lastError: null,
    });
    expect(client?.setMatchContext).toHaveBeenCalledWith(null, null);

    client?.status("offline", "Connection lost.");
    expect(useOnlineMatchStore.getState()).toMatchObject({
      connectionStatus: "offline",
      connectionDetail: "Connection lost.",
    });
  });

  it("creates a match, receives canonical creation and persists lobby context", async () => {
    await expect(useOnlineMatchStore.getState().hostMatch()).resolves.toBe(true);
    const client = MockOnlineClient.latest;
    expect(client?.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "CreateMatch",
        config: expect.objectContaining({
          visibility: "invite",
          placementMode: "QuickBalanced",
          timeControl: { kind: "untimed" },
        }),
      }),
      { matchId: null, expectedMatchVersion: null },
    );
    const commandId = useOnlineMatchStore.getState().pendingCommandId;
    expect(commandId).toMatch(/^command_mock/);

    client?.emit(
      envelope(
        {
          type: "MatchCreated",
          inviteCode: "INV00001",
          assignedSide: "Black",
          snapshot,
        },
        { causationCommandId: commandId },
      ),
    );

    expect(useOnlineMatchStore.getState()).toMatchObject({
      matchId: "match_online01",
      inviteCode: "INV00001",
      side: "Black",
      waitingForOpponent: true,
      pendingCommandId: null,
      matchVersion: 1,
      streamSequence: 1,
    });
    expect(applyOnlineSnapshot).toHaveBeenCalledWith(snapshot, {
      message: "Online match created. Share the invite code with your opponent.",
      side: "Black",
    });
    expect(window.sessionStorage.getItem("assalto:online-match")).toContain(
      "match_online01",
    );
  });

  it("joins by normalized invite code and rejects malformed codes", async () => {
    await expect(useOnlineMatchStore.getState().joinMatch("x")).resolves.toBe(
      false,
    );
    expect(useOnlineMatchStore.getState().lastError).toBe(
      "Enter a valid invite code.",
    );

    await expect(
      useOnlineMatchStore.getState().joinMatch(" inv-0001 "),
    ).resolves.toBe(true);
    expect(MockOnlineClient.latest?.send).toHaveBeenCalledWith(
      { type: "JoinMatch", inviteCode: "INV-0001" },
      { matchId: null, expectedMatchVersion: null },
    );
    expect(useOnlineMatchStore.getState()).toMatchObject({
      inviteCode: "INV-0001",
      waitingForOpponent: false,
      lastError: null,
    });
  });

  it("handles join, synchronization and stale stream protection", async () => {
    await useOnlineMatchStore.getState().connect();
    useOnlineMatchStore.setState({
      playerId: "player_alice01",
      matchId: "match_online01",
      side: "Black",
      waitingForOpponent: true,
    });
    const client = MockOnlineClient.latest;

    client?.emit(
      envelope({
        type: "PlayerJoined",
        playerId: "player_alice01",
        assignedSide: "White",
        snapshot,
      }),
    );
    expect(useOnlineMatchStore.getState()).toMatchObject({
      side: "White",
      waitingForOpponent: false,
    });

    client?.emit(
      envelope({ type: "MatchSnapshot", snapshot }, { matchVersion: 3 }),
    );
    expect(useOnlineMatchStore.getState().waitingForOpponent).toBe(false);
    expect(useGameStore.getState().message).not.toBe("Synchronizing online match…");

    const calls = applyOnlineSnapshot.mock.calls.length;
    client?.emit(
      envelope(
        { type: "MatchSnapshot", snapshot },
        { streamSequence: 2, matchVersion: 2 },
      ),
    );
    expect(applyOnlineSnapshot).toHaveBeenCalledTimes(calls);
  });

  it("maps canonical updates, decisions, turns and rematch notices", async () => {
    await useOnlineMatchStore.getState().connect();
    useOnlineMatchStore.setState({
      matchId: "match_online01",
      side: "Black",
    });
    const client = MockOnlineClient.latest;

    const updates = [
      ["PiecePlaced", "Placement accepted by the server."],
      ["PieceMoved", "Move accepted by the server."],
      ["PieceCaptured", "Move accepted by the server."],
      ["ActionApplied", "Move accepted by the server."],
      ["TurnPassed", "Turn passed."],
      ["PieceTransformed", "Transform accepted by the server."],
      ["UnknownEvent", "Match updated by the server."],
    ] as const;
    for (const [type, message] of updates) {
      client?.emit(
        envelope({
          type: "MatchUpdated",
          domainEvents: [{ type }],
          snapshot,
        }),
      );
      expect(applyOnlineSnapshot).toHaveBeenLastCalledWith(snapshot, {
        message,
        side: "Black",
      });
    }

    client?.emit(
      envelope({
        type: "DecisionRequired",
        decision: {
          kind: "defendedKing",
          attacker: [1, 1],
          king: [1, 2],
          defenders: [[1, 3]],
        },
      }),
    );
    expect(useGameStore.getState().message).toContain("Defense Pawn");

    client?.emit(
      envelope({
        type: "DecisionRequired",
        decision: {
          kind: "transform",
          pawn: [2, 2],
          options: ["AttackPawn", "DefensePawn"],
        },
      }),
    );
    expect(useGameStore.getState().message).toContain("Transform type");

    client?.emit(
      envelope({ type: "TurnChanged", currentPlayer: "White" }),
    );
    expect(useGameStore.getState().message).toBe("White to move.");

    client?.emit(
      envelope({ type: "RematchOffered", offeredBy: "player_bob0001" }),
    );
    expect(useGameStore.getState().message).toContain("offered a rematch");

    client?.emit(
      envelope({
        type: "RematchCreated",
        previousMatchId: "match_online01",
        newMatchId: "match_online02",
        inviteCode: "INV00002",
      }),
    );
    expect(useGameStore.getState().message).toBe("A rematch was created.");
  });

  it("applies rejection snapshots and terminal match state", async () => {
    await useOnlineMatchStore.getState().connect();
    useOnlineMatchStore.setState({
      matchId: "match_online01",
      side: "White",
      pendingCommandId: "command_pending01",
      matchVersion: 4,
    });
    const client = MockOnlineClient.latest;

    client?.emit(
      envelope(
        {
          type: "CommandRejected",
          commandId: "command_pending01",
          code: "version_conflict",
          message: "Your board was stale.",
          currentMatchVersion: 7,
          snapshot,
        },
        { causationCommandId: "command_pending01" },
      ),
    );
    expect(useOnlineMatchStore.getState()).toMatchObject({
      pendingCommandId: null,
      lastError: "Your board was stale.",
      lastRejectionCode: "version_conflict",
      matchVersion: 7,
    });
    expect(applyOnlineSnapshot).toHaveBeenLastCalledWith(snapshot, {
      message: "Your board was stale.",
      side: "White",
    });

    client?.emit(
      envelope({
        type: "MatchEnded",
        winner: "Black",
        reason: "resignation",
        snapshot,
      }),
    );
    expect(useOnlineMatchStore.getState()).toMatchObject({
      completed: true,
      winner: "Black",
      waitingForOpponent: false,
    });
    expect(applyOnlineSnapshot).toHaveBeenLastCalledWith(snapshot, {
      message: "Black wins by resignation.",
      side: "White",
      ended: true,
    });
  });

  it("sends every gameplay command and guards connection and pending states", async () => {
    expect(useOnlineMatchStore.getState().passTurn()).toBe(false);
    expect(useOnlineMatchStore.getState().lastError).toContain("not connected");

    await useOnlineMatchStore.getState().connect();
    useOnlineMatchStore.setState({
      matchId: "match_online01",
      connectionStatus: "connected",
      pendingCommandId: null,
    });
    const client = MockOnlineClient.latest;

    expect(useOnlineMatchStore.getState().sendPlacement([1, 2])).toBe(true);
    expect(client?.send).toHaveBeenLastCalledWith({
      type: "PlacePiece",
      position: [1, 2],
    });
    expect(useOnlineMatchStore.getState().passTurn()).toBe(false);
    expect(useOnlineMatchStore.getState().lastError).toContain(
      "previous action",
    );

    const commands = [
      () => useOnlineMatchStore.getState().sendAction([1, 2], [2, 3]),
      () => useOnlineMatchStore.getState().chooseDefender([3, 4]),
      () => useOnlineMatchStore.getState().cancelDefendedKing(),
      () => useOnlineMatchStore.getState().chooseTransform("DefensePawn"),
      () => useOnlineMatchStore.getState().passTurn(),
      () => useOnlineMatchStore.getState().resign(),
    ];
    for (const command of commands) {
      useOnlineMatchStore.setState({ pendingCommandId: null });
      expect(command()).toBe(true);
    }
    expect(client?.send.mock.calls.map(([command]) => command)).toEqual(
      expect.arrayContaining([
        {
          type: "SubmitAction",
          start: [1, 2],
          end: [2, 3],
        },
        { type: "ChooseDefender", position: [3, 4] },
        { type: "CancelDefendedKing" },
        { type: "ChooseTransform", newType: "DefensePawn" },
        { type: "PassTurn" },
        { type: "Resign" },
      ]),
    );
  });

  it("resumes persisted matches, clears errors and forgets sessions", async () => {
    await expect(useOnlineMatchStore.getState().resumeMatch()).resolves.toBe(
      false,
    );
    expect(useOnlineMatchStore.getState().lastError).toContain("no online match");

    useOnlineMatchStore.setState({
      matchId: "match_online01",
      matchVersion: 3,
      lastError: "Old error",
      lastRejectionCode: "illegal_command",
    });
    await expect(useOnlineMatchStore.getState().resumeMatch()).resolves.toBe(
      true,
    );
    expect(useGameStore.getState().message).toBe(
      "Synchronizing online match…",
    );

    useOnlineMatchStore.getState().clearError();
    expect(useOnlineMatchStore.getState()).toMatchObject({
      lastError: null,
      lastRejectionCode: null,
    });

    const client = MockOnlineClient.latest;
    useOnlineMatchStore.getState().disconnect(false);
    expect(client?.disconnect).toHaveBeenCalledOnce();
    expect(useOnlineMatchStore.getState()).toMatchObject({
      connectionStatus: "idle",
      matchId: null,
      inviteCode: null,
      side: null,
      completed: false,
    });
    expect(clearOnlineProjection).toHaveBeenCalled();
    expect(window.sessionStorage.getItem("assalto:online-match")).toBeNull();
  });
});
