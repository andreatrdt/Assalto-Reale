import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuestSessionCredentials } from "./onlineIdentity";
import type { CommandContext, OnlineConnectionStatus } from "./onlineClient";
import type { CanonicalMatchSnapshot, ClientCommand, ServerEventEnvelope } from "./protocol";

type OnlineStoreHook = (typeof import("./onlineStore"))["useOnlineMatchStore"];
type GameStoreHook = (typeof import("../game/state/gameStore"))["useGameStore"];

interface MockClientOptions {
  onStatus(status: OnlineConnectionStatus, detail?: string): void;
  onEnvelope(envelope: ServerEventEnvelope): void;
}

const PRINCIPAL: GuestSessionCredentials = {
  token: "token",
  playerId: "player_alice01",
  sessionId: "session_alice1",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

const SNAPSHOT = { schema: 1 } as unknown as CanonicalMatchSnapshot;

let configuredUrl: string | null = "ws://games.test/ws";
let connectError: Error | null = null;
let sendError: Error | null = null;
let sentId = 0;
let sequence = 0;
let onlineStore: OnlineStoreHook;
let gameStore: GameStoreHook;
let instances: MockOnlineClient[] = [];

const applyOnlineSnapshot = vi.fn(() => true);
const clearOnlineProjection = vi.fn();

class MockOnlineClient {
  readonly send = vi.fn((_command: ClientCommand, _context?: CommandContext): string => {
    if (sendError) throw sendError;
    sentId += 1;
    return `command_mock${sentId}`;
  });
  readonly setMatchContext = vi.fn((_matchId: string | null, _matchVersion: number | null) => undefined);
  readonly disconnect = vi.fn(() => undefined);

  constructor(private readonly options: MockClientOptions) {
    instances.push(this);
  }

  async connect(): Promise<GuestSessionCredentials> {
    this.options.onStatus("connecting");
    if (connectError) throw connectError;
    this.options.onStatus("connected");
    return PRINCIPAL;
  }

  emit(envelope: ServerEventEnvelope): void {
    this.options.onEnvelope(envelope);
  }

  status(status: OnlineConnectionStatus, detail?: string): void {
    this.options.onStatus(status, detail);
  }
}

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

function eventEnvelope(event: ServerEventEnvelope["event"], overrides: Partial<ServerEventEnvelope> = {}): ServerEventEnvelope {
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

function client(): MockOnlineClient {
  const value = instances.at(-1);
  if (!value) throw new Error("Expected an online client instance.");
  return value;
}

beforeEach(async () => {
  vi.resetModules();
  vi.doUnmock("./onlineClient");
  vi.doUnmock("./onlineIdentity");
  vi.doUnmock("./onlineProjection");

  configuredUrl = "ws://games.test/ws";
  connectError = null;
  sendError = null;
  sentId = 0;
  sequence = 0;
  instances = [];
  applyOnlineSnapshot.mockClear();
  clearOnlineProjection.mockClear();
  vi.stubGlobal("window", { sessionStorage: memoryStorage() });

  vi.doMock("./onlineClient", () => ({ OnlineClient: MockOnlineClient }));
  vi.doMock("./onlineIdentity", () => ({
    configuredWebSocketUrl: () => configuredUrl,
  }));
  vi.doMock("./onlineProjection", () => ({
    applyOnlineSnapshot,
    clearOnlineProjection,
  }));

  onlineStore = (await import("./onlineStore")).useOnlineMatchStore;
  gameStore = (await import("../game/state/gameStore")).useGameStore;
});

afterEach(() => {
  onlineStore.getState().disconnect(false);
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("online match store", () => {
  it("fails closed when unconfigured or when connection setup fails", async () => {
    configuredUrl = null;
    await expect(onlineStore.getState().connect()).resolves.toBe(false);
    expect(onlineStore.getState()).toMatchObject({
      connectionStatus: "error",
      connectionDetail: "Online play is not configured for this deployment.",
      lastError: "Set VITE_MULTIPLAYER_WS_URL to enable online play.",
    });

    configuredUrl = "ws://games.test/ws";
    connectError = new Error("identity unavailable");
    await expect(onlineStore.getState().connect()).resolves.toBe(false);
    expect(onlineStore.getState()).toMatchObject({
      connectionStatus: "error",
      connectionDetail: null,
      lastError: "identity unavailable",
    });
  });

  it("creates and persists an authoritative waiting room", async () => {
    await expect(onlineStore.getState().hostMatch()).resolves.toBe(true);
    expect(client().send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "CreateMatch",
        config: expect.objectContaining({
          visibility: "invite",
          placementMode: "Manual",
          transformEnabled: true,
          timeControl: { kind: "untimed" },
        }),
      }),
      { matchId: null, expectedMatchVersion: null },
    );
    const commandId = onlineStore.getState().pendingCommandId;

    client().emit(
      eventEnvelope(
        {
          type: "MatchCreated",
          inviteCode: "INV00001",
          assignedSide: "Black",
          snapshot: SNAPSHOT,
        },
        { causationCommandId: commandId },
      ),
    );

    expect(onlineStore.getState()).toMatchObject({
      connectionStatus: "connected",
      playerId: PRINCIPAL.playerId,
      sessionId: PRINCIPAL.sessionId,
      matchId: "match_online01",
      inviteCode: "INV00001",
      side: "Black",
      waitingForOpponent: true,
      pendingCommandId: null,
      matchVersion: 1,
      streamSequence: 1,
    });
    expect(applyOnlineSnapshot).toHaveBeenCalledWith(SNAPSHOT, {
      message: "Online match created. Share the invite code with your opponent.",
      side: "Black",
    });
    expect(window.sessionStorage.getItem("assalto:online-match")).toContain("match_online01");
    expect(client().setMatchContext).toHaveBeenLastCalledWith("match_online01", 1);

    const projectionCalls = applyOnlineSnapshot.mock.calls.length;
    client().emit(eventEnvelope({ type: "MatchSnapshot", snapshot: SNAPSHOT }, { streamSequence: 1, matchVersion: 1 }));
    expect(applyOnlineSnapshot).toHaveBeenCalledTimes(projectionCalls);
  });

  it("normalizes invite codes and handles join and sync events", async () => {
    await expect(onlineStore.getState().joinMatch("x")).resolves.toBe(false);
    expect(onlineStore.getState().lastError).toBe("Enter a valid invite code.");

    await expect(onlineStore.getState().joinMatch(" inv-0001 ")).resolves.toBe(true);
    expect(client().send).toHaveBeenLastCalledWith(
      { type: "JoinMatch", inviteCode: "INV-0001" },
      { matchId: null, expectedMatchVersion: null },
    );

    client().emit(
      eventEnvelope({
        type: "PlayerJoined",
        playerId: PRINCIPAL.playerId,
        assignedSide: "White",
        snapshot: SNAPSHOT,
      }),
    );
    expect(onlineStore.getState()).toMatchObject({
      side: "White",
      waitingForOpponent: false,
      lastError: null,
    });

    client().emit(eventEnvelope({ type: "MatchSnapshot", snapshot: SNAPSHOT }, { matchVersion: 3 }));
    expect(onlineStore.getState()).toMatchObject({
      waitingForOpponent: false,
      matchVersion: 3,
    });
    expect(applyOnlineSnapshot).toHaveBeenLastCalledWith(SNAPSHOT, {
      message: "Online match synchronized.",
      side: "White",
    });
  });

  it("maps canonical updates, decisions, turns and rematch notices", async () => {
    await onlineStore.getState().connect();
    onlineStore.setState({
      matchId: "match_online01",
      side: "Black",
    });

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
      client().emit(
        eventEnvelope({
          type: "MatchUpdated",
          domainEvents: [{ type }],
          snapshot: SNAPSHOT,
        }),
      );
      expect(applyOnlineSnapshot).toHaveBeenLastCalledWith(SNAPSHOT, {
        message,
        side: "Black",
      });
    }

    client().emit(
      eventEnvelope({
        type: "DecisionRequired",
        decision: {
          kind: "defendedKing",
          owner: "Black",
          defenders: [[1, 3]],
          attackerOrigin: [1, 1],
          kingPosition: [1, 2],
          landingPosition: [1, 4],
        },
      }),
    );
    expect(gameStore.getState().message).toContain("Defense Pawn");

    client().emit(
      eventEnvelope({
        type: "DecisionRequired",
        decision: {
          kind: "transform",
          owner: "White",
          position: [2, 2],
          currentType: "ConquestPawn",
          options: ["AttackPawn", "DefensePawn"],
        },
      }),
    );
    expect(gameStore.getState().message).toContain("Transform type");

    client().emit(eventEnvelope({ type: "TurnChanged", currentPlayer: "White" }));
    expect(gameStore.getState().message).toBe("White to move.");

    client().emit(
      eventEnvelope({
        type: "RematchOffered",
        offeredByPlayerId: "player_bob0001",
      }),
    );
    expect(gameStore.getState().message).toContain("offered a rematch");

    client().emit(
      eventEnvelope({
        type: "RematchCreated",
        newMatchId: "match_online02",
        inviteCode: "INV00002",
      }),
    );
    expect(gameStore.getState().message).toBe("A rematch was created.");
  });

  it("applies rejections, terminal state and every gameplay command", async () => {
    expect(onlineStore.getState().passTurn()).toBe(false);
    expect(onlineStore.getState().lastError).toContain("not connected");

    await onlineStore.getState().connect();
    onlineStore.setState({
      matchId: "match_online01",
      side: "White",
      matchVersion: 4,
      connectionStatus: "connected",
      pendingCommandId: null,
    });

    expect(onlineStore.getState().sendPlacement([1, 2])).toBe(true);
    expect(client().send).toHaveBeenLastCalledWith({
      type: "PlacePiece",
      position: [1, 2],
    });
    expect(onlineStore.getState().passTurn()).toBe(false);
    expect(onlineStore.getState().lastError).toContain("previous action");

    const commands = [
      () => onlineStore.getState().sendAction([1, 2], [2, 3]),
      () => onlineStore.getState().chooseDefender([3, 4]),
      () => onlineStore.getState().cancelDefendedKing(),
      () => onlineStore.getState().chooseTransform("DefensePawn"),
      () => onlineStore.getState().passTurn(),
      () => onlineStore.getState().resign(),
    ];
    for (const command of commands) {
      onlineStore.setState({ pendingCommandId: null });
      expect(command()).toBe(true);
    }
    const sentCommands = (client().send.mock.calls as unknown as Array<[ClientCommand]>).map(([command]) => command);
    expect(sentCommands).toEqual(
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

    onlineStore.setState({ pendingCommandId: "command_pending01" });
    client().emit(
      eventEnvelope(
        {
          type: "CommandRejected",
          commandId: "command_pending01",
          code: "stale_match_version",
          message: "Your board was stale.",
          currentMatchVersion: 7,
          snapshot: SNAPSHOT,
        },
        { causationCommandId: "command_pending01" },
      ),
    );
    expect(onlineStore.getState()).toMatchObject({
      pendingCommandId: null,
      lastError: "Your board was stale.",
      lastRejectionCode: "stale_match_version",
      matchVersion: 7,
    });

    client().emit(
      eventEnvelope({
        type: "MatchEnded",
        winner: "Black",
        loser: "White",
        reason: "resignation",
        snapshot: SNAPSHOT,
      }),
    );
    expect(onlineStore.getState()).toMatchObject({
      completed: true,
      winner: "Black",
      waitingForOpponent: false,
    });
    expect(applyOnlineSnapshot).toHaveBeenLastCalledWith(SNAPSHOT, {
      message: "Black wins by resignation.",
      side: "White",
      ended: true,
    });
  });

  it("resumes, reports send failures and forgets the online session", async () => {
    await expect(onlineStore.getState().resumeMatch()).resolves.toBe(false);
    expect(onlineStore.getState().lastError).toContain("no online match");

    onlineStore.setState({
      matchId: "match_online01",
      matchVersion: 3,
      lastError: "Old error",
      lastRejectionCode: "illegal_command",
    });
    await expect(onlineStore.getState().resumeMatch()).resolves.toBe(true);
    expect(gameStore.getState().message).toBe("Synchronizing online match…");

    sendError = new Error("socket write failed");
    onlineStore.setState({
      connectionStatus: "connected",
      pendingCommandId: null,
    });
    expect(onlineStore.getState().passTurn()).toBe(false);
    expect(onlineStore.getState().lastError).toBe("socket write failed");

    onlineStore.getState().clearError();
    expect(onlineStore.getState()).toMatchObject({
      lastError: null,
      lastRejectionCode: null,
    });

    const activeClient = client();
    onlineStore.getState().disconnect(false);
    expect(activeClient.disconnect).toHaveBeenCalledOnce();
    expect(onlineStore.getState()).toMatchObject({
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
