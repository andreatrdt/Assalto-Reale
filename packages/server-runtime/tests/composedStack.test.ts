import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createInMemoryPersistence } from "@assalto-reale/authoritative-server";
import {
  composeServer,
  loadConfig,
  type ComposedServer,
} from "../src/index.js";
import {
  MANUAL_CONFIG,
  QUICK_CONFIG,
  TEST_ORIGIN,
  TEST_SECRET,
  TestClient,
  acquireGuestSession,
  commandMessage,
} from "./support.js";

// A real composed-stack test: HTTP guest sessions + two authenticated WebSocket
// clients + gameplay + reconnect, over the actual transport. It uses in-memory
// persistence so it runs everywhere; the PostgreSQL-backed variant lives in
// postgresRuntime.test.ts and runs when TEST_DATABASE_URL is present.

let composed: ComposedServer;
let baseUrl: string;
let wsBase: string;

beforeAll(async () => {
  const config = loadConfig({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused",
    MULTIPLAYER_ALLOWED_ORIGINS: TEST_ORIGIN,
    GUEST_SESSION_SECRET: TEST_SECRET,
    HEARTBEAT_INTERVAL_MS: "1000",
  });
  composed = composeServer({
    config,
    persistence: createInMemoryPersistence(),
  });
  const address = await composed.server.listen({ host: "127.0.0.1", port: 0 });
  baseUrl = `http://127.0.0.1:${address.port}`;
  wsBase = `ws://127.0.0.1:${address.port}${address.websocketPath}`;
});

afterAll(async () => {
  await composed.server.close();
});

describe("composed multiplayer stack (in-memory)", () => {
  it("runs the full invite → join → play → reconnect journey for two guests", async () => {
    // 1 + 3: two independent guest sessions over HTTP.
    const sessionA = await acquireGuestSession(baseUrl);
    const sessionB = await acquireGuestSession(baseUrl);
    expect(sessionA.playerId).not.toBe(sessionB.playerId);

    const clientA = await TestClient.connect(wsBase, sessionA);

    // 2: player A creates an invite-only match.
    clientA.send(
      commandMessage(sessionA, QUICK_CONFIG, { commandId: "cmd_create_a01" }),
    );
    const created = await clientA.waitFor("MatchCreated");
    const matchId = created.matchId!;
    const inviteCode = (created.event as { inviteCode: string }).inviteCode;
    expect(
      (created.event as { snapshot: { schema: number } }).snapshot.schema,
    ).toBe(1);

    // 4 + 5: player B joins with ONLY the invite code (matchId omitted → null),
    // exactly as the second device does: it never learns the matchId until the
    // server resolves the invite. Both connections then receive canonical state.
    const clientB = await TestClient.connect(wsBase, sessionB);
    clientB.send(
      commandMessage(
        sessionB,
        { type: "JoinMatch", inviteCode },
        { commandId: "cmd_join_b0001" },
      ),
    );
    const joinedForB = await clientB.waitFor("PlayerJoined");
    const joinedForA = await clientA.waitFor("PlayerJoined");
    expect(joinedForA.matchVersion).toBe(2);
    // The server stamped the canonical matchId onto the events it broadcast, even
    // though B supplied none.
    expect(joinedForB.matchId).toBe(matchId);
    expect((joinedForB.event as { assignedSide: string }).assignedSide).toBe(
      "White",
    );

    // 6: one legal gameplay command (Black passes the turn).
    clientA.send(
      commandMessage(
        sessionA,
        { type: "PassTurn" },
        { commandId: "cmd_pass_a0001", matchId, expectedMatchVersion: 2 },
      ),
    );
    // 7: the other connection receives the resulting canonical update.
    const updateForB = await clientB.waitFor("MatchUpdated");
    expect(updateForB.matchVersion).toBe(3);
    const turnForB = await clientB.waitFor("TurnChanged");
    expect((turnForB.event as { currentPlayer: string }).currentPlayer).toBe(
      "White",
    );

    // 8: reconnect + RequestSync recovers canonical state.
    await clientA.close();
    const clientA2 = await TestClient.connect(wsBase, sessionA);
    clientA2.send(
      commandMessage(
        sessionA,
        { type: "RequestSync", lastSeenMatchVersion: null },
        { commandId: "cmd_sync_a0001", matchId },
      ),
    );
    const snapshot = await clientA2.waitFor("MatchSnapshot");
    expect(snapshot.matchVersion).toBe(3);
    expect(
      (snapshot.event as { snapshot: { schema: number } }).snapshot.schema,
    ).toBe(1);

    await clientB.close();
    await clientA2.close();
  }, 20000);

  it("restores a manual-placement match after a client disconnects and reconnects", async () => {
    // Production reconnect scenario: a browser refresh during placement.
    const sessionA = await acquireGuestSession(baseUrl);
    const sessionB = await acquireGuestSession(baseUrl);
    const clientA = await TestClient.connect(wsBase, sessionA);

    clientA.send(
      commandMessage(sessionA, MANUAL_CONFIG, { commandId: "cmd_m_create01" }),
    );
    const created = await clientA.waitFor("MatchCreated");
    const matchId = created.matchId!;
    const inviteCode = (created.event as { inviteCode: string }).inviteCode;

    const clientB = await TestClient.connect(wsBase, sessionB);
    clientB.send(
      commandMessage(
        sessionB,
        { type: "JoinMatch", inviteCode },
        { commandId: "cmd_m_join0001" },
      ),
    );
    await clientB.waitFor("PlayerJoined");
    await clientA.waitFor("PlayerJoined");

    // Black (the creator) places the first piece (King, placement cursor 0).
    clientA.send(
      commandMessage(
        sessionA,
        { type: "PlacePiece", position: [0, 0] },
        { commandId: "cmd_m_place001", matchId, expectedMatchVersion: 2 },
      ),
    );
    const placed = await clientB.waitFor("MatchUpdated");
    expect(placed.matchVersion).toBe(3);

    // Client A "refreshes": drop the socket, reconnect on the same guest session,
    // and RequestSync — the canonical placement state must come back intact.
    await clientA.close();
    const clientA2 = await TestClient.connect(wsBase, sessionA);
    clientA2.send(
      commandMessage(
        sessionA,
        { type: "RequestSync", lastSeenMatchVersion: null },
        { commandId: "cmd_m_sync0001", matchId },
      ),
    );
    const snapshot = await clientA2.waitFor("MatchSnapshot");
    expect(snapshot.matchVersion).toBe(3);
    const state = (snapshot.event as { snapshot: unknown }).snapshot as {
      schema: number;
      phase: string;
      placementCursor: number;
    };
    expect(state.schema).toBe(1);
    // Still in placement, with exactly the one placed piece reflected (the queue
    // advanced from Black King to the next placement).
    expect(state.phase).toBe("placement");
    expect(state.placementCursor).toBe(1);

    await clientB.close();
    await clientA2.close();
  }, 20000);

  it("rejects a WebSocket upgrade without a valid guest token", async () => {
    await expect(
      new Promise((resolve, reject) => {
        const socket = new WebSocket(
          `${wsBase}?access_token=not-a-real-token`,
          { headers: { origin: TEST_ORIGIN } },
        );
        socket.once("open", () => {
          socket.close();
          resolve("opened");
        });
        socket.once("error", reject);
      }),
    ).rejects.toThrow();
  });

  it("refuses a guest session from a disallowed origin", async () => {
    const response = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  it("serves liveness and readiness endpoints", async () => {
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/readyz`)).status).toBe(200);
  });
});
