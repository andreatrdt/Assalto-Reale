import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedPrincipal } from "@assalto-reale/authoritative-server";
import type { ServerEventEnvelope } from "@assalto-reale/multiplayer-protocol";
import { WebSocket } from "ws";
import {
  createAuthoritativeTransportServer,
  type AuthenticatedCommandExecutor,
  type AuthoritativeTransportServer,
  type ConnectionAuthenticator,
} from "../src/index.js";
import {
  ALICE,
  BOB,
  ONLINE_CONFIG,
  TokenConnectionAuthenticator,
  applicationHarness,
  closeCode,
  commandMessage,
  nextEnvelope,
  nextEnvelopes,
  openSocket,
  rejectedSocket,
  sendJson,
} from "./support.js";

const servers: AuthoritativeTransportServer[] = [];
const sockets: WebSocket[] = [];

async function start(
  options: Parameters<typeof createAuthoritativeTransportServer>[0],
): Promise<{
  server: AuthoritativeTransportServer;
  httpUrl: string;
  wsUrl: string;
}> {
  const server = createAuthoritativeTransportServer({
    heartbeatIntervalMs: 0,
    shutdownGraceMs: 20,
    ...options,
  });
  servers.push(server);
  const address = await server.listen();
  const httpUrl = `http://127.0.0.1:${address.port}`;
  return {
    server,
    httpUrl,
    wsUrl: `ws://127.0.0.1:${address.port}${address.websocketPath}`,
  };
}

function track(socket: WebSocket): WebSocket {
  sockets.push(socket);
  return socket;
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("authoritative HTTP/WebSocket transport", () => {
  it("serves health, readiness, HEAD, method and not-found responses", async () => {
    const readiness = { check: vi.fn(async () => false) };
    const { server, httpUrl } = await start({
      executor: { execute: async () => [] },
      authenticateConnection: { authenticate: async () => null },
      readiness,
    });

    const health = await fetch(`${httpUrl}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(health.headers.get("cache-control")).toBe("no-store");

    const head = await fetch(`${httpUrl}/healthz`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const ready = await fetch(`${httpUrl}/readyz`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: "not_ready" });
    expect(readiness.check).toHaveBeenCalledOnce();

    expect((await fetch(`${httpUrl}/missing`)).status).toBe(404);
    expect((await fetch(`${httpUrl}/healthz`, { method: "POST" })).status).toBe(
      405,
    );

    const second = await server.listen();
    expect(second.port).toBe(Number(new URL(httpUrl).port));
  });

  it("defaults readiness to ready and fails closed when a probe throws", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const first = await start({
      executor: { execute: async () => [] },
      authenticateConnection: { authenticate: async () => null },
    });
    expect((await fetch(`${first.httpUrl}/readyz`)).status).toBe(200);

    const second = await start({
      executor: { execute: async () => [] },
      authenticateConnection: { authenticate: async () => null },
      readiness: {
        check: async () => {
          throw new Error("database unavailable");
        },
      },
      logger,
    });
    expect((await fetch(`${second.httpUrl}/readyz`)).status).toBe(503);
    expect(logger.error).toHaveBeenCalledWith(
      "Readiness probe failed.",
      expect.objectContaining({ error: "database unavailable" }),
    );
  });

  it("rejects wrong paths, unauthenticated clients and disallowed origins", async () => {
    const { httpUrl, wsUrl } = await start({
      executor: { execute: async () => [] },
      authenticateConnection: new TokenConnectionAuthenticator({
        alice: { playerId: ALICE, sessionId: "session_alice" },
      }),
      allowedOrigins: ["https://allowed.example"],
    });

    await rejectedSocket(`${httpUrl.replace("http", "ws")}/other`, 404, {
      token: "alice",
    });
    await rejectedSocket(wsUrl, 401);
    await rejectedSocket(wsUrl, 403, {
      token: "alice",
      origin: "https://blocked.example",
    });
    const socket = track(
      await openSocket(wsUrl, {
        token: "alice",
        origin: "https://allowed.example",
      }),
    );
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it("returns service unavailable when connection authentication throws", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const authenticateConnection: ConnectionAuthenticator = {
      authenticate: async () => {
        throw new Error("identity provider down");
      },
    };
    const { wsUrl } = await start({
      executor: { execute: async () => [] },
      authenticateConnection,
      logger,
    });

    await rejectedSocket(wsUrl, 503);
    expect(logger.error).toHaveBeenCalledWith(
      "Connection authentication failed unexpectedly.",
      expect.objectContaining({ error: "identity provider down" }),
    );
  });

  it("uses the connection principal and returns structured invalid/spoof rejections", async () => {
    const application = applicationHarness();
    const { wsUrl } = await start({
      executor: application.executor,
      authenticateConnection: new TokenConnectionAuthenticator({
        alice: { playerId: ALICE, sessionId: "session_alice" },
      }),
    });
    const alice = track(await openSocket(wsUrl, { token: "alice" }));

    const invalidResponse = nextEnvelope(alice);
    alice.send("not-json");
    expect((await invalidResponse).event).toMatchObject({
      type: "CommandRejected",
      code: "invalid_message",
    });

    const spoofResponse = nextEnvelope(alice);
    sendJson(
      alice,
      commandMessage(
        { type: "CreateMatch", config: ONLINE_CONFIG },
        { commandId: "command_spoof01", playerId: BOB },
      ),
    );
    expect((await spoofResponse).event).toMatchObject({
      type: "CommandRejected",
      code: "unauthorized",
    });
  });

  it("routes create, join, reconnect sync and match broadcasts", async () => {
    const application = applicationHarness();
    const { wsUrl } = await start({
      executor: application.executor,
      authenticateConnection: new TokenConnectionAuthenticator({
        alice: { playerId: ALICE, sessionId: "session_alice" },
        alice2: { playerId: ALICE, sessionId: "session_alice2" },
        bob: { playerId: BOB, sessionId: "session_bob0001" },
      }),
    });
    const alice = track(await openSocket(wsUrl, { token: "alice" }));
    const bob = track(await openSocket(wsUrl, { token: "bob" }));

    const createdPromise = nextEnvelope(alice);
    sendJson(
      alice,
      commandMessage(
        { type: "CreateMatch", config: ONLINE_CONFIG },
        { commandId: "command_create1", playerId: ALICE },
      ),
    );
    const created = await createdPromise;
    expect(created.event.type).toBe("MatchCreated");
    if (created.event.type !== "MatchCreated" || !created.matchId) {
      throw new Error("Expected MatchCreated with matchId.");
    }

    const aliceJoined = nextEnvelope(alice);
    const bobJoined = nextEnvelope(bob);
    sendJson(
      bob,
      commandMessage(
        { type: "JoinMatch", inviteCode: created.event.inviteCode },
        {
          commandId: "command_join0001",
          playerId: BOB,
          matchId: created.matchId,
        },
      ),
    );
    const [aliceJoinEvent, bobJoinEvent] = await Promise.all([
      aliceJoined,
      bobJoined,
    ]);
    expect(aliceJoinEvent).toEqual(bobJoinEvent);
    expect(bobJoinEvent.event.type).toBe("PlayerJoined");

    const aliceReconnect = track(await openSocket(wsUrl, { token: "alice2" }));
    const oldSessionSync = nextEnvelope(alice);
    const reconnectSync = nextEnvelope(aliceReconnect);
    sendJson(
      aliceReconnect,
      commandMessage(
        { type: "RequestSync", lastSeenMatchVersion: null },
        {
          commandId: "command_sync0001",
          playerId: ALICE,
          sessionId: "session_alice2",
          matchId: created.matchId,
        },
      ),
    );
    const [oldSync, newSync] = await Promise.all([
      oldSessionSync,
      reconnectSync,
    ]);
    expect(oldSync).toEqual(newSync);
    expect(newSync.event.type).toBe("MatchSnapshot");

    const aliceEnded = nextEnvelope(alice);
    const reconnectEnded = nextEnvelope(aliceReconnect);
    const bobEnded = nextEnvelope(bob);
    sendJson(
      bob,
      commandMessage(
        { type: "Resign" },
        {
          commandId: "command_resign01",
          playerId: BOB,
          matchId: created.matchId,
          expectedMatchVersion: 2,
        },
      ),
    );
    const ended = await Promise.all([aliceEnded, reconnectEnded, bobEnded]);
    expect(ended[0]).toEqual(ended[1]);
    expect(ended[1]).toEqual(ended[2]);
    expect(ended[0]?.event).toMatchObject({
      type: "MatchEnded",
      reason: "resignation",
    });
  });

  it("serializes commands from one connection", async () => {
    const completed: number[] = [];
    const executor: AuthenticatedCommandExecutor = {
      async execute(principal, rawMessage) {
        const sequence = Number((rawMessage as { sequence: number }).sequence);
        if (sequence === 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        completed.push(sequence);
        return [privateRejection(principal, sequence)];
      },
    };
    const { wsUrl } = await start({
      executor,
      authenticateConnection: new TokenConnectionAuthenticator({
        alice: { playerId: ALICE, sessionId: "session_alice" },
      }),
    });
    const alice = track(await openSocket(wsUrl, { token: "alice" }));
    const received = nextEnvelopes(alice, 2);
    alice.send(JSON.stringify({ sequence: 1 }));
    alice.send(JSON.stringify({ sequence: 2 }));

    const [firstEnvelope, secondEnvelope] = await received;
    if (!firstEnvelope || !secondEnvelope) {
      throw new Error("Expected two ordered envelopes.");
    }
    expect(completed).toEqual([1, 2]);
    expect(firstEnvelope.causationCommandId).toBe("command_order01");
    expect(secondEnvelope.causationCommandId).toBe("command_order02");
  });

  it("closes binary clients and performs graceful idempotent shutdown", async () => {
    const { server, wsUrl } = await start({
      executor: { execute: async () => [] },
      authenticateConnection: new TokenConnectionAuthenticator({
        alice: { playerId: ALICE, sessionId: "session_alice" },
      }),
    });
    const binary = track(await openSocket(wsUrl, { token: "alice" }));
    const binaryClose = closeCode(binary);
    binary.send(Buffer.from([1, 2, 3]), { binary: true });
    await expect(binaryClose).resolves.toBe(1003);

    const graceful = track(await openSocket(wsUrl, { token: "alice" }));
    const gracefulClose = closeCode(graceful);
    const firstClose = server.close();
    const secondClose = server.close();
    expect(secondClose).toBe(firstClose);
    await firstClose;
    await expect(gracefulClose).resolves.toBe(1001);
  });
});

function privateRejection(
  principal: AuthenticatedPrincipal,
  sequence: number,
): ServerEventEnvelope {
  const commandId = `command_order0${sequence}`;
  return {
    protocol: "assalto-reale",
    protocolVersion: 1,
    messageType: "event",
    eventId: `event_order000${sequence}`,
    emittedAt: "2026-01-01T00:00:00.000Z",
    matchId: null,
    matchVersion: null,
    streamSequence: null,
    causationCommandId: commandId,
    recipient: { playerId: principal.playerId },
    event: {
      type: "CommandRejected",
      commandId,
      code: "invalid_message",
      message: `sequence ${sequence}`,
      currentMatchVersion: null,
    },
  };
}
