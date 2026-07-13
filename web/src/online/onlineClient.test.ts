import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnlineClient } from "./onlineClient";
import { encodeServerMessage, type ServerEventEnvelope } from "./protocol";

function closeEvent(code: number): Event {
  const event = new Event("close") as Event & { code: number };
  Object.defineProperty(event, "code", { value: code });
  return event;
}

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly closeCalls: Array<[number | undefined, string | undefined]> = [];

  send(value: string): void {
    this.sent.push(value);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push([code, reason]);
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(closeEvent(code ?? 1000));
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  message(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  fail(): void {
    this.dispatchEvent(new Event("error"));
  }

  lose(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(closeEvent(code));
  }
}

const CREDENTIALS = {
  token: "signed guest token",
  playerId: "player_guest0001",
  sessionId: "session_guest001",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

function rejection(commandId = "command_server01"): ServerEventEnvelope {
  return {
    protocol: "assalto-reale",
    protocolVersion: 1,
    messageType: "event",
    eventId: "event_server0001",
    emittedAt: "2026-07-10T18:00:00.000Z",
    matchId: null,
    matchVersion: null,
    streamSequence: null,
    causationCommandId: commandId,
    recipient: { playerId: CREDENTIALS.playerId },
    event: {
      type: "CommandRejected",
      commandId,
      code: "invalid_message",
      message: "Rejected for test.",
      currentMatchVersion: null,
    },
  };
}

async function allowConnectionSetup(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("crypto", {
    randomUUID: () => "12345678-1234-1234-1234-123456789abc",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OnlineClient", () => {
  it("connects once, exposes the principal and sends canonical commands", async () => {
    const sockets: FakeWebSocket[] = [];
    const statuses: Array<[string, string | undefined]> = [];
    const acquireSession = vi.fn(async () => CREDENTIALS);
    const client = new OnlineClient({
      websocketUrl: "wss://games.example/ws",
      acquireSession,
      createWebSocket: (url) => {
        expect(url).toBe("wss://games.example/ws?access_token=signed+guest+token");
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onStatus: (status, detail) => statuses.push([status, detail]),
      onEnvelope: vi.fn(),
      setTimeout: vi.fn() as unknown as typeof window.setTimeout,
      clearTimeout: vi.fn() as unknown as typeof window.clearTimeout,
    });

    const first = client.connect();
    const second = client.connect();
    expect(statuses).toEqual([["connecting", undefined]]);
    await allowConnectionSetup();
    expect(sockets).toHaveLength(1);

    sockets[0]?.open();
    await expect(Promise.all([first, second])).resolves.toEqual([CREDENTIALS, CREDENTIALS]);
    expect(client.connected).toBe(true);
    expect(client.principal).toEqual({
      playerId: CREDENTIALS.playerId,
      sessionId: CREDENTIALS.sessionId,
    });
    expect(statuses.at(-1)).toEqual(["connected", undefined]);
    expect(acquireSession).toHaveBeenCalledOnce();

    client.setMatchContext("match_online01", 7);
    const id = client.send({ type: "PassTurn" });
    expect(id).toBe("command_12345678123412341234123456789abc");
    expect(JSON.parse(sockets[0]?.sent.at(-1) ?? "{}")).toMatchObject({
      commandId: id,
      actor: {
        playerId: CREDENTIALS.playerId,
        sessionId: CREDENTIALS.sessionId,
      },
      matchId: "match_online01",
      expectedMatchVersion: 7,
      command: { type: "PassTurn" },
    });

    await expect(client.connect()).resolves.toEqual(CREDENTIALS);
    expect(sockets).toHaveLength(1);
  });

  it("encodes an invite-code JoinMatch with no matchId (the second-device join)", async () => {
    const socket = new FakeWebSocket();
    const client = new OnlineClient({
      websocketUrl: "wss://games.example/ws",
      acquireSession: async () => CREDENTIALS,
      createWebSocket: () => socket as unknown as WebSocket,
      onStatus: vi.fn(),
      onEnvelope: vi.fn(),
      setTimeout: vi.fn() as unknown as typeof window.setTimeout,
      clearTimeout: vi.fn() as unknown as typeof window.clearTimeout,
    });

    const connected = client.connect();
    await allowConnectionSetup();
    socket.open();
    await connected;

    // The joining device only knows the invite code, so matchId is null. This
    // must produce a valid envelope, not throw (the production join-by-code bug).
    let id = "";
    expect(() => {
      id = client.send({ type: "JoinMatch", inviteCode: "ABCD1234" }, { matchId: null, expectedMatchVersion: null });
    }).not.toThrow();
    expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({
      commandId: id,
      matchId: null,
      expectedMatchVersion: null,
      command: { type: "JoinMatch", inviteCode: "ABCD1234" },
    });
  });

  it("requests a canonical sync when a match context reconnects", async () => {
    const socket = new FakeWebSocket();
    const client = new OnlineClient({
      websocketUrl: "wss://games.example/ws",
      acquireSession: async () => CREDENTIALS,
      createWebSocket: () => socket as unknown as WebSocket,
      onStatus: vi.fn(),
      onEnvelope: vi.fn(),
      setTimeout: vi.fn() as unknown as typeof window.setTimeout,
      clearTimeout: vi.fn() as unknown as typeof window.clearTimeout,
    });
    client.setMatchContext("match_online01", 4);

    const connected = client.connect();
    await allowConnectionSetup();
    socket.open();
    await connected;

    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      matchId: "match_online01",
      expectedMatchVersion: null,
      command: { type: "RequestSync", lastSeenMatchVersion: 4 },
    });
  });

  it("decodes canonical server messages and reports invalid payloads", async () => {
    const socket = new FakeWebSocket();
    const onEnvelope = vi.fn();
    const onStatus = vi.fn();
    const client = new OnlineClient({
      websocketUrl: "wss://games.example/ws",
      acquireSession: async () => CREDENTIALS,
      createWebSocket: () => socket as unknown as WebSocket,
      onStatus,
      onEnvelope,
      setTimeout: vi.fn() as unknown as typeof window.setTimeout,
      clearTimeout: vi.fn() as unknown as typeof window.clearTimeout,
    });

    const connected = client.connect();
    await allowConnectionSetup();
    socket.open();
    await connected;

    const envelope = rejection();
    socket.message(encodeServerMessage(envelope));
    expect(onEnvelope).toHaveBeenCalledWith(envelope);

    socket.message("not-json");
    expect(onStatus).toHaveBeenCalledWith("error", "Message is not valid JSON.");

    socket.message(new Uint8Array([1, 2, 3]));
    expect(onEnvelope).toHaveBeenCalledTimes(1);
  });

  it("rejects failed opens and distinguishes abnormal close codes", async () => {
    const first = new FakeWebSocket();
    const errorClient = new OnlineClient({
      websocketUrl: "wss://games.example/ws",
      acquireSession: async () => CREDENTIALS,
      createWebSocket: () => first as unknown as WebSocket,
      onStatus: vi.fn(),
      onEnvelope: vi.fn(),
      setTimeout: vi.fn() as unknown as typeof window.setTimeout,
      clearTimeout: vi.fn() as unknown as typeof window.clearTimeout,
    });
    const failed = errorClient.connect();
    await allowConnectionSetup();
    first.fail();
    await expect(failed).rejects.toThrow("could not be reached");

    const second = new FakeWebSocket();
    const closeClient = new OnlineClient({
      websocketUrl: "wss://games.example/ws",
      acquireSession: async () => CREDENTIALS,
      createWebSocket: () => second as unknown as WebSocket,
      onStatus: vi.fn(),
      onEnvelope: vi.fn(),
      setTimeout: vi.fn() as unknown as typeof window.setTimeout,
      clearTimeout: vi.fn() as unknown as typeof window.clearTimeout,
    });
    const closed = closeClient.connect();
    await allowConnectionSetup();
    second.lose(1008);
    await expect(closed).rejects.toThrow("closed (1008)");
  });

  it("schedules reconnects after a live connection drops", async () => {
    const sockets: FakeWebSocket[] = [];
    const scheduled: Array<() => void> = [];
    const statuses: Array<[string, string | undefined]> = [];
    const client = new OnlineClient({
      websocketUrl: "wss://games.example/ws",
      acquireSession: async () => CREDENTIALS,
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onStatus: (status, detail) => statuses.push([status, detail]),
      onEnvelope: vi.fn(),
      setTimeout: ((callback: TimerHandler) => {
        scheduled.push(callback as () => void);
        return scheduled.length as unknown as number;
      }) as typeof window.setTimeout,
      clearTimeout: vi.fn() as unknown as typeof window.clearTimeout,
    });

    const initial = client.connect();
    await allowConnectionSetup();
    sockets[0]?.open();
    await initial;
    sockets[0]?.lose();

    expect(statuses.at(-1)).toEqual(["offline", "Connection lost. Reconnecting…"]);
    expect(scheduled).toHaveLength(1);

    scheduled.shift()?.();
    expect(statuses.at(-1)).toEqual(["reconnecting", undefined]);
    expect(sockets).toHaveLength(2);
    sockets[1]?.open();
    await Promise.resolve();
    expect(client.connected).toBe(true);
  });

  it("replays a pending create/join with its fixed commandId when no match exists yet", async () => {
    const socket = new FakeWebSocket();
    const client = new OnlineClient({
      websocketUrl: "wss://games.example/ws",
      acquireSession: async () => CREDENTIALS,
      createWebSocket: () => socket as unknown as WebSocket,
      onStatus: vi.fn(),
      onEnvelope: vi.fn(),
      setTimeout: vi.fn() as unknown as typeof window.setTimeout,
      clearTimeout: vi.fn() as unknown as typeof window.clearTimeout,
    });
    client.setLifecycleReplay({
      commandId: "command_fixedcreate1",
      command: {
        type: "CreateMatch",
        config: {
          visibility: "invite",
          placementMode: "Manual",
          transformEnabled: true,
          preferredSide: "Random",
          timeControl: { kind: "untimed" },
        },
      },
    });

    const connected = client.connect();
    await allowConnectionSetup();
    socket.open();
    await connected;

    // The recovery replay uses the *original* commandId so the server can replay
    // the authoritative result instead of creating a second match.
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      commandId: "command_fixedcreate1",
      matchId: null,
      expectedMatchVersion: null,
      command: { type: "CreateMatch" },
    });
  });

  it("stops reconnecting and reports 'expired' when a cached token has expired mid-match", async () => {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const expiring = { ...CREDENTIALS, expiresAt: "2026-01-01T00:10:00.000Z" };
    const sockets: FakeWebSocket[] = [];
    const scheduled: Array<() => void> = [];
    const statuses: Array<[string, string | undefined]> = [];
    const acquireSession = vi.fn(async () => expiring);
    const client = new OnlineClient({
      websocketUrl: "wss://games.example/ws",
      acquireSession,
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onStatus: (status, detail) => statuses.push([status, detail]),
      onEnvelope: vi.fn(),
      now: () => now,
      setTimeout: ((callback: TimerHandler) => {
        scheduled.push(callback as () => void);
        return scheduled.length as unknown as number;
      }) as typeof window.setTimeout,
      clearTimeout: vi.fn() as unknown as typeof window.clearTimeout,
    });
    // Identity-bound work: an active match the anonymous identity owns.
    client.setMatchContext("match_online01", 3);

    const connected = client.connect();
    await allowConnectionSetup();
    sockets[0]?.open();
    await connected;

    // The token expires while connected; the live socket then drops.
    now = Date.parse("2026-01-01T01:00:00.000Z");
    sockets[0]?.lose(1006);
    expect(scheduled).toHaveLength(1);

    // The scheduled reconnect must detect the expiry, report it, and NOT loop.
    scheduled.shift()?.();
    await allowConnectionSetup();

    expect(statuses.at(-1)).toEqual(["expired", "Your session has expired."]);
    expect(sockets).toHaveLength(1); // no new socket opened with the dead token
    expect(scheduled).toHaveLength(0); // no further reconnect scheduled
    expect(acquireSession).toHaveBeenCalledTimes(1); // no silent new identity
  });

  it("acquires a fresh session when an expired token guards no match or intent", async () => {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const sockets: FakeWebSocket[] = [];
    const scheduled: Array<() => void> = [];
    const tokens = [
      { ...CREDENTIALS, expiresAt: "2026-01-01T00:10:00.000Z" },
      { ...CREDENTIALS, playerId: "player_fresh0001", expiresAt: "2026-01-01T02:00:00.000Z" },
    ];
    const acquireSession = vi.fn(async () => tokens.shift() ?? CREDENTIALS);
    const client = new OnlineClient({
      websocketUrl: "wss://games.example/ws",
      acquireSession,
      createWebSocket: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onStatus: vi.fn(),
      onEnvelope: vi.fn(),
      now: () => now,
      setTimeout: ((callback: TimerHandler) => {
        scheduled.push(callback as () => void);
        return scheduled.length as unknown as number;
      }) as typeof window.setTimeout,
      clearTimeout: vi.fn() as unknown as typeof window.clearTimeout,
    });
    // No match context and no replay: expiry here is safe to resolve with a new
    // guest identity (nothing depends on the old one).

    const connected = client.connect();
    await allowConnectionSetup();
    sockets[0]?.open();
    await connected;

    now = Date.parse("2026-01-01T01:00:00.000Z");
    sockets[0]?.lose(1006);
    scheduled.shift()?.();
    await allowConnectionSetup();

    expect(acquireSession).toHaveBeenCalledTimes(2); // dropped the stale token, fetched fresh
    expect(sockets).toHaveLength(2);
  });

  it("acquires a new one-time registered ticket for reconnect with the same player identity", async () => {
    const sockets: FakeWebSocket[] = [];
    const urls: string[] = [];
    const scheduled: Array<() => void> = [];
    let ticket = 0;
    const acquireSession = vi.fn(async () => ({
      ...CREDENTIALS,
      token: `ticket-${++ticket}`,
      authKind: "registered" as const,
    }));
    const client = new OnlineClient({
      websocketUrl: "wss://games.example/ws",
      acquireSession,
      createWebSocket: (url) => {
        urls.push(url);
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onStatus: vi.fn(),
      onEnvelope: vi.fn(),
      setTimeout: ((callback: TimerHandler) => {
        scheduled.push(callback as () => void);
        return scheduled.length as unknown as number;
      }) as typeof window.setTimeout,
      clearTimeout: vi.fn() as unknown as typeof window.clearTimeout,
    });
    client.setMatchContext("match_online01", 4);
    const connected = client.connect();
    await allowConnectionSetup();
    sockets[0]?.open();
    await connected;
    sockets[0]?.lose();
    scheduled.shift()?.();
    await allowConnectionSetup();
    sockets[1]?.open();

    expect(acquireSession).toHaveBeenCalledTimes(2);
    expect(acquireSession).toHaveBeenNthCalledWith(2, "wss://games.example/ws", "match_online01");
    expect(urls).toEqual(["wss://games.example/ws?ticket=ticket-1", "wss://games.example/ws?ticket=ticket-2"]);
    expect(client.principal).toEqual({
      playerId: CREDENTIALS.playerId,
      sessionId: CREDENTIALS.sessionId,
    });
  });

  it("cancels reconnect work and closes cleanly", async () => {
    const socket = new FakeWebSocket();
    const onStatus = vi.fn();
    const clearTimeout = vi.fn();
    const scheduled: Array<() => void> = [];
    const client = new OnlineClient({
      websocketUrl: "wss://games.example/ws",
      acquireSession: async () => CREDENTIALS,
      createWebSocket: () => socket as unknown as WebSocket,
      onStatus,
      onEnvelope: vi.fn(),
      setTimeout: ((callback: TimerHandler) => {
        scheduled.push(callback as () => void);
        return 44 as unknown as number;
      }) as typeof window.setTimeout,
      clearTimeout: clearTimeout as unknown as typeof window.clearTimeout,
    });

    const connected = client.connect();
    await allowConnectionSetup();
    socket.open();
    await connected;
    socket.lose();
    client.disconnect();

    expect(clearTimeout).toHaveBeenCalledWith(44);
    expect(onStatus).toHaveBeenLastCalledWith("idle");
    expect(client.connected).toBe(false);
    expect(() => client.send({ type: "PassTurn" })).toThrow("not ready");
  });
});
