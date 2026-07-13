import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  AccountSessionRevokedError,
  createInMemoryPersistence,
  type AccountRepository,
  type RegisteredSession,
} from "@assalto-reale/authoritative-server";
import { HmacGuestSessionService } from "@assalto-reale/server-transport";
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
  placementView,
  snapshotFromEvent,
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
  it("runs guest and registered sockets together and reconnects the registered membership", async () => {
    const now = new Date("2028-01-01T00:00:00.000Z");
    const registered: RegisteredSession = {
      user: {
        userId: "user_stack001",
        status: "active",
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      identity: {
        authIdentityId: "identity_stack001",
        userId: "user_stack001",
        issuer: "http://issuer.test/",
        providerSubject: "auth0|stack001",
        verifiedEmail: null,
        createdAt: now,
        updatedAt: now,
      },
      session: {
        sessionId: "session_stack001",
        userId: "user_stack001",
        authIdentityId: "identity_stack001",
        playerId: "player_stack001",
        expiresAt: new Date("2028-01-02T00:00:00.000Z"),
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      playerIdentity: {
        playerId: "player_stack001",
        userId: "user_stack001",
        kind: "registered",
        createdAt: now,
        claimedAt: now,
        revokedAt: null,
      },
    };
    let revoked = false;
    const tickets = new Map<
      string,
      { playerId: string; sessionId: string; expiresAt: Date }
    >();
    const accounts: AccountRepository = {
      ensureGuestIdentity: async (playerId) => ({
        playerId,
        userId: null,
        kind: "guest",
        createdAt: now,
        claimedAt: null,
        revokedAt: null,
      }),
      isGuestAuthenticationAllowed: async () => true,
      provisionRegisteredSession: async () => {
        if (revoked) throw new AccountSessionRevokedError();
        return registered;
      },
      loadSession: async () => (revoked ? null : registered),
      revokeSession: async () => {
        revoked = true;
        return true;
      },
      claimGuestIdentity: async () => registered,
      listActiveMatches: async () => [],
      resolveMatchPlayer: async () => registered.playerIdentity.playerId,
      saveWebsocketTicket: async (input) => {
        tickets.set(input.ticketHash, {
          playerId: input.playerId,
          sessionId: input.sessionId,
          expiresAt: input.expiresAt,
        });
      },
      consumeWebsocketTicket: async (hash, consumedAt = new Date()) => {
        const ticket = tickets.get(hash);
        if (!ticket || ticket.expiresAt <= consumedAt) return null;
        tickets.delete(hash);
        return { playerId: ticket.playerId, sessionId: ticket.sessionId };
      },
    };
    const config = loadConfig({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused",
      MULTIPLAYER_ALLOWED_ORIGINS: TEST_ORIGIN,
      GUEST_SESSION_SECRET: TEST_SECRET,
      HEARTBEAT_INTERVAL_MS: "1000",
      AUTH_ENABLED: "true",
      AUTH_ISSUER_URL: "http://issuer.test/",
      AUTH_AUDIENCE: "assalto-test",
      AUTH_SESSION_ID_CLAIM: "https://assalto.test/session_id",
    });
    const stack = composeServer({
      config,
      persistence: { ...createInMemoryPersistence(), accounts },
      registeredAccessTokenVerifier: {
        verify: async (token) =>
          token === "registered-access"
            ? {
                issuer: "http://issuer.test/",
                providerSubject: "auth0|stack001",
                providerSessionId: "provider-session-stack001",
                expiresAt: registered.session.expiresAt,
                verifiedEmail: null,
              }
            : null,
      },
      registeredTicketNow: () => now,
    });
    const address = await stack.server.listen({ host: "127.0.0.1", port: 0 });
    const localBase = `http://127.0.0.1:${address.port}`;
    const localWs = `ws://127.0.0.1:${address.port}${address.websocketPath}`;
    const authHeaders = {
      origin: TEST_ORIGIN,
      authorization: "Bearer registered-access",
      "content-type": "application/json",
    };
    try {
      const guest = await acquireGuestSession(localBase);
      const guestClient = await TestClient.connect(localWs, guest);
      guestClient.send(
        commandMessage(guest, QUICK_CONFIG, { commandId: "cmd_mixed_create" }),
      );
      const created = await guestClient.waitFor("MatchCreated");
      const matchId = created.matchId!;
      const inviteCode = (created.event as { inviteCode: string }).inviteCode;

      expect(
        (
          await fetch(`${localBase}/auth/session`, {
            method: "POST",
            headers: authHeaders,
          })
        ).status,
      ).toBe(200);
      const ticketResponse = await fetch(`${localBase}/auth/websocket-ticket`, {
        method: "POST",
        headers: authHeaders,
        body: "{}",
      });
      const ticket = (await ticketResponse.json()) as { ticket: string };
      const registeredClient = await TestClient.connectTicket(
        localWs,
        ticket.ticket,
      );
      registeredClient.send(
        commandMessage(
          {
            token: "unused",
            playerId: registered.playerIdentity.playerId,
            sessionId: registered.session.sessionId,
            expiresAt: registered.session.expiresAt.toISOString(),
          },
          { type: "JoinMatch", inviteCode },
          { commandId: "cmd_mixed_join" },
        ),
      );
      await registeredClient.waitFor("PlayerJoined");
      await registeredClient.close();

      const reconnectResponse = await fetch(
        `${localBase}/auth/websocket-ticket`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ matchId }),
        },
      );
      const reconnectTicket = (await reconnectResponse.json()) as {
        ticket: string;
      };
      const reconnected = await TestClient.connectTicket(
        localWs,
        reconnectTicket.ticket,
      );
      reconnected.send(
        commandMessage(
          {
            token: "unused",
            playerId: registered.playerIdentity.playerId,
            sessionId: registered.session.sessionId,
            expiresAt: registered.session.expiresAt.toISOString(),
          },
          { type: "RequestSync", lastSeenMatchVersion: null },
          {
            commandId: "cmd_mixed_sync",
            matchId,
          },
        ),
      );
      await expect(reconnected.waitFor("MatchSnapshot")).resolves.toMatchObject(
        { matchId },
      );
      await reconnected.close();
      await guestClient.close();

      expect(
        (
          await fetch(`${localBase}/auth/logout`, {
            method: "POST",
            headers: authHeaders,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(`${localBase}/auth/session`, {
            method: "POST",
            headers: authHeaders,
          })
        ).status,
      ).toBe(401);
    } finally {
      await stack.server.close();
    }
  }, 20_000);

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
    const canonical = snapshotFromEvent(snapshot.event);
    expect(canonical.schema).toBe(1);
    const placement = placementView(canonical);
    // Still in placement, with exactly the one placed piece reflected (the queue
    // advanced from Black King to the next placement).
    expect(placement.phase).toBe("placement");
    expect(placement.placementCursor).toBe(1);

    await clientB.close();
    await clientA2.close();
  }, 20000);

  it("starts a server-authoritative rematch with the same two players after a match ends", async () => {
    const sessionA = await acquireGuestSession(baseUrl);
    const sessionB = await acquireGuestSession(baseUrl);
    const clientA = await TestClient.connect(wsBase, sessionA);

    // A creates (Black), B joins (White).
    clientA.send(
      commandMessage(sessionA, MANUAL_CONFIG, { commandId: "cmd_rm_create1" }),
    );
    const created = await clientA.waitFor("MatchCreated");
    const matchId = created.matchId!;
    const inviteCode = (created.event as { inviteCode: string }).inviteCode;

    const clientB = await TestClient.connect(wsBase, sessionB);
    clientB.send(
      commandMessage(
        sessionB,
        { type: "JoinMatch", inviteCode },
        { commandId: "cmd_rm_join001" },
      ),
    );
    await clientB.waitFor("PlayerJoined");
    await clientA.waitFor("PlayerJoined");

    // End the match: A resigns.
    clientA.send(
      commandMessage(
        sessionA,
        { type: "Resign" },
        { commandId: "cmd_rm_resign1", matchId, expectedMatchVersion: 2 },
      ),
    );
    await clientB.waitFor("MatchEnded");

    // A requests a rematch; B is notified and accepts.
    clientA.send(
      commandMessage(
        sessionA,
        { type: "OfferRematch" },
        { commandId: "cmd_rm_offer01", matchId },
      ),
    );
    const offered = await clientB.waitFor("RematchOffered");
    expect(
      (offered.event as { offeredByPlayerId: string }).offeredByPlayerId,
    ).toBe(sessionA.playerId);

    clientB.send(
      commandMessage(
        sessionB,
        { type: "RespondToRematch", accept: true },
        { commandId: "cmd_rm_accept1", matchId },
      ),
    );

    // Both clients receive the same new match id, with swapped sides.
    const rematchForA = await clientA.waitFor("RematchCreated");
    const rematchForB = await clientB.waitFor("RematchCreated");
    const newMatchId = (rematchForA.event as { newMatchId: string }).newMatchId;
    expect(newMatchId).not.toBe(matchId);
    expect((rematchForB.event as { newMatchId: string }).newMatchId).toBe(
      newMatchId,
    );
    expect((rematchForA.event as { assignedSide: string }).assignedSide).toBe(
      "White",
    );
    expect((rematchForB.event as { assignedSide: string }).assignedSide).toBe(
      "Black",
    );
    // Fresh manual-placement board.
    const rematchBoard = placementView(snapshotFromEvent(rematchForB.event));
    expect(rematchBoard.phase).toBe("placement");
    expect(rematchBoard.placementCursor).toBe(0);

    // The new match is live: B (now Black) places the first piece.
    clientB.send(
      commandMessage(
        sessionB,
        { type: "PlacePiece", position: [0, 0] },
        {
          commandId: "cmd_rm_place01",
          matchId: newMatchId,
          expectedMatchVersion: 1,
        },
      ),
    );
    const placed = await clientB.waitFor("MatchUpdated");
    expect(placed.matchVersion).toBe(2);

    // Reconnect A: syncing the OLD match resolves to the rematch, not the completed match.
    await clientA.close();
    const clientA2 = await TestClient.connect(wsBase, sessionA);
    clientA2.send(
      commandMessage(
        sessionA,
        { type: "RequestSync", lastSeenMatchVersion: null },
        { commandId: "cmd_rm_sync001", matchId },
      ),
    );
    const resolved = await clientA2.waitFor("RematchCreated");
    expect((resolved.event as { newMatchId: string }).newMatchId).toBe(
      newMatchId,
    );
    expect((resolved.event as { assignedSide: string }).assignedSide).toBe(
      "White",
    );

    await clientB.close();
    await clientA2.close();
  }, 20000);

  it("recovers canonically when a command's response is lost after the server commits", async () => {
    const sessionA = await acquireGuestSession(baseUrl);
    const sessionB = await acquireGuestSession(baseUrl);
    const clientA = await TestClient.connect(wsBase, sessionA);

    clientA.send(
      commandMessage(sessionA, MANUAL_CONFIG, { commandId: "cmd_lr_create1" }),
    );
    const created = await clientA.waitFor("MatchCreated");
    const matchId = created.matchId!;
    const inviteCode = (created.event as { inviteCode: string }).inviteCode;

    const clientB = await TestClient.connect(wsBase, sessionB);
    clientB.send(
      commandMessage(
        sessionB,
        { type: "JoinMatch", inviteCode },
        { commandId: "cmd_lr_join001" },
      ),
    );
    await clientB.waitFor("PlayerJoined");
    await clientA.waitFor("PlayerJoined");

    // A places the first piece (Black King). The server commits, but A "loses"
    // the response: it drops the socket before processing its own MatchUpdated.
    clientA.send(
      commandMessage(
        sessionA,
        { type: "PlacePiece", position: [0, 0] },
        { commandId: "cmd_lr_place01", matchId, expectedMatchVersion: 2 },
      ),
    );
    // The opponent's broadcast confirms the server committed (version 3).
    const committed = await clientB.waitFor("MatchUpdated");
    expect(committed.matchVersion).toBe(3);
    await clientA.close();

    // A reconnects and requests canonical sync: the committed placement is there.
    const clientA2 = await TestClient.connect(wsBase, sessionA);
    clientA2.send(
      commandMessage(
        sessionA,
        { type: "RequestSync", lastSeenMatchVersion: null },
        { commandId: "cmd_lr_sync001", matchId },
      ),
    );
    const snapshot = await clientA2.waitFor("MatchSnapshot");
    expect(snapshot.matchVersion).toBe(3);
    expect((snapshot.event as { status: string }).status).toBe("active");
    const recovered = placementView(snapshotFromEvent(snapshot.event));
    expect(recovered.phase).toBe("placement");
    expect(recovered.placementCursor).toBe(1); // Black King already placed

    // The next valid command proceeds from the recovered version (White King).
    clientB.send(
      commandMessage(
        sessionB,
        { type: "PlacePiece", position: [0, 11] },
        { commandId: "cmd_lr_place02", matchId, expectedMatchVersion: 3 },
      ),
    );
    const next = await clientA2.waitFor("MatchUpdated");
    expect(next.matchVersion).toBe(4);

    await clientB.close();
    await clientA2.close();
  }, 20000);

  it("replays the original CreateMatch result when its response is lost and the same commandId reconnects", async () => {
    const sessionA = await acquireGuestSession(baseUrl);
    const clientA = await TestClient.connect(wsBase, sessionA);

    // Player A creates a match. Assume the MatchCreated response is lost: A drops
    // the socket before acting on it and never learns the matchId locally.
    const createCommandId = "cmd_cr_create1";
    clientA.send(
      commandMessage(sessionA, MANUAL_CONFIG, { commandId: createCommandId }),
    );
    const created = await clientA.waitFor("MatchCreated");
    const matchId = created.matchId!;
    const inviteCode = (created.event as { inviteCode: string }).inviteCode;
    await clientA.close();

    // A reconnects on the SAME guest session and replays the SAME CreateMatch
    // command with the SAME commandId. Idempotency returns the original result.
    const clientA2 = await TestClient.connect(wsBase, sessionA);
    clientA2.send(
      commandMessage(sessionA, MANUAL_CONFIG, { commandId: createCommandId }),
    );
    const replayed = await clientA2.waitFor("MatchCreated");

    // The original identity is recovered, not a second match.
    expect(replayed.matchId).toBe(matchId);
    expect((replayed.event as { inviteCode: string }).inviteCode).toBe(
      inviteCode,
    );
    expect((replayed.event as { assignedSide: string }).assignedSide).toBe(
      (created.event as { assignedSide: string }).assignedSide,
    );

    // A second guest joining with the invite proves exactly one match exists and
    // is joinable (a duplicate create would have produced a different code).
    const sessionB = await acquireGuestSession(baseUrl);
    const clientB = await TestClient.connect(wsBase, sessionB);
    clientB.send(
      commandMessage(
        sessionB,
        { type: "JoinMatch", inviteCode },
        { commandId: "cmd_cr_join001" },
      ),
    );
    const joined = await clientB.waitFor("PlayerJoined");
    expect(joined.matchId).toBe(matchId);

    await clientA2.close();
    await clientB.close();
  }, 20000);

  it("replays the original JoinMatch result when its response is lost and the same commandId reconnects", async () => {
    const sessionA = await acquireGuestSession(baseUrl);
    const sessionB = await acquireGuestSession(baseUrl);
    const clientA = await TestClient.connect(wsBase, sessionA);
    clientA.send(
      commandMessage(sessionA, MANUAL_CONFIG, { commandId: "cmd_jr_create1" }),
    );
    const created = await clientA.waitFor("MatchCreated");
    const matchId = created.matchId!;
    const inviteCode = (created.event as { inviteCode: string }).inviteCode;

    // B joins; assume B's PlayerJoined response is lost (B drops before reading it).
    const joinCommandId = "cmd_jr_join001";
    const clientB = await TestClient.connect(wsBase, sessionB);
    clientB.send(
      commandMessage(
        sessionB,
        { type: "JoinMatch", inviteCode },
        { commandId: joinCommandId },
      ),
    );
    const joinedFirst = await clientB.waitFor("PlayerJoined");
    const assignedSide = (joinedFirst.event as { assignedSide: string })
      .assignedSide;
    await clientA.waitFor("PlayerJoined");
    await clientB.close();

    // B reconnects and replays the SAME JoinMatch commandId: the original result
    // is returned and no second membership is created.
    const clientB2 = await TestClient.connect(wsBase, sessionB);
    clientB2.send(
      commandMessage(
        sessionB,
        { type: "JoinMatch", inviteCode },
        { commandId: joinCommandId },
      ),
    );
    const joinedReplay = await clientB2.waitFor("PlayerJoined");

    expect(joinedReplay.matchId).toBe(matchId);
    expect((joinedReplay.event as { playerId: string }).playerId).toBe(
      sessionB.playerId,
    );
    expect((joinedReplay.event as { assignedSide: string }).assignedSide).toBe(
      assignedSide,
    );
    // The match is still at version 2 (one join), not advanced by the replay.
    expect(joinedReplay.matchVersion).toBe(2);

    await clientA.close();
    await clientB2.close();
  }, 20000);

  it("rejects a reconnect that presents a deterministically expired guest token", async () => {
    // Mint a correctly-signed token whose expiry is already in the past relative
    // to the running server, exactly as a stale cached credential would be.
    const expiredIssuer = new HmacGuestSessionService(TEST_SECRET, {
      ttlMs: 1_000,
      now: () => Date.parse("2000-01-01T00:00:00.000Z"),
    });
    const expired = await expiredIssuer.issue();

    // The upgrade is rejected (auth failure), indistinguishable to the browser
    // from close 1006 — which is why the client stops on `expiresAt`, not on the
    // close code. Here we assert the server side: the expired token cannot connect.
    await expect(
      new Promise((resolve, reject) => {
        const socket = new WebSocket(
          `${wsBase}?access_token=${expired.token}`,
          {
            headers: { origin: TEST_ORIGIN },
          },
        );
        socket.once("open", () => {
          socket.close();
          resolve("opened");
        });
        socket.once("error", reject);
      }),
    ).rejects.toThrow();
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
