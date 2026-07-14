import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  AccountSessionRevokedError,
  emptyPlayerStatistics,
  type AccountRepository,
  type MatchHistoryRepository,
  type RegisteredSession,
} from "@assalto-reale/authoritative-server";
import type {
  MatchHistoryDetails,
  MatchHistoryPage,
} from "@assalto-reale/multiplayer-protocol";
import {
  GuestOrRegisteredConnectionAuthenticator,
  GuestSessionConnectionAuthenticator,
  HmacGuestSessionService,
  RegisteredAuthService,
  RegisteredTicketConnectionAuthenticator,
  createAuthoritativeTransportServer,
  type AuthoritativeTransportServer,
} from "../src/index.js";

const NOW = new Date("2028-01-01T00:00:00.000Z");
const SECRET = "0123456789abcdef0123456789abcdef";
const REGISTERED: RegisteredSession = {
  user: {
    userId: "user_account001",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  },
  identity: {
    authIdentityId: "identity_account001",
    userId: "user_account001",
    issuer: "https://tenant.example/",
    providerSubject: "auth0|account001",
    verifiedEmail: "player@example.test",
    createdAt: NOW,
    updatedAt: NOW,
  },
  session: {
    sessionId: "session_account001",
    userId: "user_account001",
    authIdentityId: "identity_account001",
    playerId: "player_account001",
    expiresAt: new Date("2028-01-02T00:00:00.000Z"),
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  playerIdentity: {
    playerId: "player_account001",
    userId: "user_account001",
    kind: "registered",
    createdAt: NOW,
    claimedAt: NOW,
    revokedAt: null,
  },
};

function harness() {
  let revoked = false;
  let ticket: {
    ticketHash: string;
    sessionId: string;
    playerId: string;
    expiresAt: Date;
  } | null = null;
  const accounts: AccountRepository = {
    ensureGuestIdentity: vi.fn(),
    isGuestAuthenticationAllowed: vi.fn(async () => true),
    provisionRegisteredSession: vi.fn(async () => {
      if (revoked) throw new AccountSessionRevokedError();
      return REGISTERED;
    }),
    loadSession: vi.fn(async () => (revoked ? null : REGISTERED)),
    revokeSession: vi.fn(async () => {
      revoked = true;
      return true;
    }),
    claimGuestIdentity: vi.fn(async (_sessionId, playerId) => ({
      ...REGISTERED,
      session: { ...REGISTERED.session, playerId },
      playerIdentity: {
        ...REGISTERED.playerIdentity,
        playerId,
        kind: "guest" as const,
      },
    })),
    listActiveMatches: vi.fn(async () => [
      {
        matchId: "match_account001",
        playerId: "player_account001",
        side: "White" as const,
        status: "active" as const,
        updatedAt: NOW,
      },
    ]),
    resolveMatchPlayer: vi.fn(async (_userId, matchId) =>
      matchId === "match_account001" ? "player_account001" : null,
    ),
    saveWebsocketTicket: vi.fn(async (input) => {
      ticket = input;
    }),
    consumeWebsocketTicket: vi.fn(async (hash, now) => {
      const saved = ticket;
      if (
        !saved ||
        saved.ticketHash !== hash ||
        saved.expiresAt <= (now ?? new Date())
      )
        return null;
      ticket = null;
      return { playerId: saved.playerId, sessionId: saved.sessionId };
    }),
  };
  const verifier = {
    verify: vi.fn(async (token: string) =>
      token === "valid-access-token"
        ? {
            issuer: "https://tenant.example/",
            providerSubject: "auth0|account001",
            providerSessionId: "provider-session-001",
            expiresAt: new Date("2028-01-02T00:00:00.000Z"),
            verifiedEmail: "player@example.test",
          }
        : null,
    ),
  };
  const guest = new HmacGuestSessionService(SECRET, {
    now: () => NOW.getTime(),
    randomId: () => "guestidentifier1234",
  });
  const history: MatchHistoryRepository = {
    listForUser: vi.fn(
      async () =>
        ({
          matches: [
            {
              matchId: "match_history001",
              completedAt: NOW.toISOString(),
              opponent: {
                side: "White",
                kind: "guest",
                displayIdentity: "Guest player",
              },
              side: "Black",
              result: "win",
              victoryReason: "resignation",
              durationSeconds: 30,
              turnCount: 2,
              predecessorMatchId: null,
              successorMatchId: null,
              replayAvailable: true,
            },
          ],
          nextCursor: null,
        }) satisfies MatchHistoryPage,
    ),
    getForUser: vi.fn(async (_userId, matchId) =>
      matchId === "match_history001"
        ? ({ matchId, replayAvailable: true } as MatchHistoryDetails)
        : null,
    ),
    statisticsForUser: vi.fn(async () => ({
      ...emptyPlayerStatistics(),
      gamesPlayed: 1,
      wins: 1,
    })),
  };
  const auth = new RegisteredAuthService(
    verifier,
    accounts,
    guest,
    30_000,
    () => NOW,
    () => "A".repeat(43),
    history,
  );
  return { accounts, auth, guest, history, isRevoked: () => revoked };
}

const servers: AuthoritativeTransportServer[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("registered account authentication", () => {
  it("establishes, upgrades, scopes and consumes a one-time WebSocket ticket", async () => {
    const { accounts, auth, guest } = harness();
    await expect(auth.establishSession("invalid")).rejects.toMatchObject({
      status: 401,
      code: "invalid_token",
    });
    const guestSession = await guest.issue();
    await expect(
      auth.upgradeGuest("valid-access-token", guestSession.token),
    ).resolves.toMatchObject({
      kind: "registered",
      playerId: guestSession.playerId,
    });
    expect(accounts.claimGuestIdentity).toHaveBeenCalledWith(
      REGISTERED.session.sessionId,
      guestSession.playerId,
      NOW,
    );
    await expect(
      auth.issueWebsocketTicket("valid-access-token", "match_not_owned"),
    ).rejects.toMatchObject({
      status: 403,
      code: "match_not_owned",
    });
    const issued = await auth.issueWebsocketTicket(
      "valid-access-token",
      "match_account001",
    );
    await expect(auth.consumeWebsocketTicket(issued.ticket)).resolves.toEqual({
      playerId: "player_account001",
      sessionId: "session_account001",
      authKind: "registered",
    });
    await expect(
      auth.consumeWebsocketTicket(issued.ticket),
    ).resolves.toBeNull();
  });

  it("serves CORS-restricted HTTP auth, logout revocation and registered WebSocket upgrade", async () => {
    const { auth, guest, history, isRevoked } = harness();
    const authenticator = new GuestOrRegisteredConnectionAuthenticator(
      new GuestSessionConnectionAuthenticator(guest),
      new RegisteredTicketConnectionAuthenticator(auth),
    );
    const server = createAuthoritativeTransportServer({
      executor: { execute: async () => [] },
      authenticateConnection: authenticator,
      guestSessions: guest,
      registeredAuth: auth,
      allowedOrigins: ["https://play.example"],
      heartbeatIntervalMs: 0,
    });
    servers.push(server);
    const address = await server.listen();
    const base = `http://127.0.0.1:${address.port}`;
    const headers = {
      origin: "https://play.example",
      authorization: "Bearer valid-access-token",
    };

    expect(
      (await fetch(`${base}/auth/session`, { method: "POST", headers })).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${base}/auth/session`, {
          method: "POST",
          headers: { ...headers, origin: "https://blocked.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/auth/session`, {
          method: "POST",
          headers: { origin: "https://play.example" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${base}/auth/upgrade-guest`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: "not-json",
        })
      ).status,
    ).toBe(400);

    const ticketResponse = await fetch(`${base}/auth/websocket-ticket`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ matchId: "match_account001" }),
    });
    expect(ticketResponse.status).toBe(201);
    const ticket = (await ticketResponse.json()) as { ticket: string };
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}${address.websocketPath}?ticket=${ticket.ticket}`,
      { origin: "https://play.example" },
    );
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    expect(socket.readyState).toBe(WebSocket.OPEN);

    const historyResponse = await fetch(
      `${base}/auth/matches/history?limit=10&result=win&side=Black`,
      { headers },
    );
    expect(historyResponse.status).toBe(200);
    await expect(historyResponse.json()).resolves.toMatchObject({
      matches: [{ matchId: "match_history001", result: "win" }],
    });
    expect(history.listForUser).toHaveBeenCalledWith("user_account001", {
      limit: 10,
      result: "win",
      side: "Black",
    });
    expect(
      (
        await fetch(`${base}/auth/matches/history/match_history001`, {
          headers,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${base}/auth/matches/history/match_unknown001`, {
          headers,
        })
      ).status,
    ).toBe(404);
    expect(
      (await fetch(`${base}/auth/matches/history?limit=0`, { headers })).status,
    ).toBe(400);
    await expect(
      (await fetch(`${base}/auth/statistics`, { headers })).json(),
    ).resolves.toMatchObject({ gamesPlayed: 1, wins: 1 });

    expect(
      (await fetch(`${base}/auth/logout`, { method: "POST", headers })).status,
    ).toBe(200);
    expect(isRevoked()).toBe(true);
    const revoked = await fetch(`${base}/auth/session`, {
      method: "POST",
      headers,
    });
    expect(revoked.status).toBe(401);
    await expect(revoked.text()).resolves.not.toContain("valid-access-token");
  });
});
