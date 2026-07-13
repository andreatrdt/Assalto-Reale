import { describe, expect, it, vi } from "vitest";
import type { AccountSummary, ActiveAccountMatch } from "./accountApi";
import { AccountApiError } from "./accountApi";
import { AccountSessionHydrator, restoreAccountSession } from "./accountSessionHydration";

const ACCOUNT: AccountSummary = {
  kind: "registered",
  user: { userId: "user_1", status: "active", email: "player@example.test" },
  playerId: "player_1",
  sessionId: "session_1",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

const MATCHES: ActiveAccountMatch[] = [
  { matchId: "match_account01", side: "White", status: "active", updatedAt: "2029-01-01T00:00:00.000Z" },
];

function api() {
  return {
    establish: vi.fn(async () => ACCOUNT),
    upgradeGuest: vi.fn(async () => ACCOUNT),
    matches: vi.fn(async () => MATCHES),
    websocketTicket: vi.fn(async () => ({
      ticket: "ticket_1",
      playerId: "player_1",
      sessionId: "session_1",
      expiresAt: "2030-01-01T00:00:00.000Z",
    })),
  };
}

function loginRequired(): Error & { error: string } {
  return Object.assign(new Error("Login required"), { error: "login_required" });
}

describe("account refresh hydration", () => {
  it("restores an authenticated account automatically from a silent provider token", async () => {
    const backend = api();
    const getAccessToken = vi.fn(async () => "access-token");

    const result = await restoreAccountSession({
      apiBaseUrl: "https://api.example/auth",
      getAccessToken,
      guestSession: null,
      api: backend,
    });

    expect(result).toMatchObject({ state: "signed-in", account: ACCOUNT, matches: MATCHES });
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(backend.establish).toHaveBeenCalledWith("https://api.example/auth", "access-token");
  });

  it("resolves a missing Auth0 session cleanly to guest without provisioning", async () => {
    const backend = api();
    const result = await restoreAccountSession({
      apiBaseUrl: "https://api.example/auth",
      getAccessToken: async () => {
        throw loginRequired();
      },
      guestSession: null,
      api: backend,
    });

    expect(result).toEqual({
      state: "guest",
      account: null,
      matches: [],
      ticketProvider: null,
      upgradedGuest: false,
      error: null,
    });
    expect(backend.establish).not.toHaveBeenCalled();
  });

  it("keeps a logout followed by refresh signed out", async () => {
    const backend = api();
    let providerSession = true;
    const getAccessToken = async () => {
      if (providerSession) return "access-token";
      throw loginRequired();
    };
    const beforeLogout = new AccountSessionHydrator(() =>
      restoreAccountSession({
        apiBaseUrl: "https://api.example/auth",
        getAccessToken,
        guestSession: null,
        api: backend,
      }),
    );
    await expect(beforeLogout.hydrate()).resolves.toMatchObject({ state: "signed-in", account: ACCOUNT });

    providerSession = false;
    const afterLogout = new AccountSessionHydrator(() =>
      restoreAccountSession({
        apiBaseUrl: "https://api.example/auth",
        getAccessToken,
        guestSession: null,
        api: backend,
      }),
    );

    await expect(afterLogout.hydrate()).resolves.toMatchObject({ state: "guest", account: null });
    expect(backend.establish).toHaveBeenCalledTimes(1);
  });

  it("memoizes a silent restoration failure so rerenders cannot loop", async () => {
    const getAccessToken = vi.fn(async () => {
      throw new Error("provider unavailable");
    });
    const hydrator = new AccountSessionHydrator(() =>
      restoreAccountSession({
        apiBaseUrl: "https://api.example/auth",
        getAccessToken,
        guestSession: null,
        api: api(),
      }),
    );

    const [first, second] = await Promise.all([hydrator.hydrate(), hydrator.hydrate()]);
    expect(first).toMatchObject({ state: "auth-failed" });
    expect(second).toBe(first);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });

  it("reports an expired or revoked application session clearly", async () => {
    const backend = api();
    backend.establish.mockRejectedValueOnce(new AccountApiError(401, "session_revoked", "revoked"));

    await expect(
      restoreAccountSession({
        apiBaseUrl: "https://api.example/auth",
        getAccessToken: async () => "access-token",
        guestSession: null,
        api: backend,
      }),
    ).resolves.toMatchObject({ state: "session-expired", account: null, error: expect.stringContaining("expired or ended") });
  });

  it("lets a restored account obtain a registered WebSocket ticket", async () => {
    const backend = api();
    const getAccessToken = vi.fn().mockResolvedValueOnce("restore-token").mockResolvedValueOnce("fresh-ticket-token");
    const result = await restoreAccountSession({
      apiBaseUrl: "https://api.example/auth",
      getAccessToken,
      guestSession: null,
      api: backend,
    });

    expect(result.state).toBe("signed-in");
    if (result.state !== "signed-in") throw new Error("Expected a restored account.");
    await expect(result.ticketProvider("wss://games.example/ws", "match_account01")).resolves.toEqual({
      token: "ticket_1",
      playerId: "player_1",
      sessionId: "session_1",
      expiresAt: "2030-01-01T00:00:00.000Z",
      authKind: "registered",
      ticket: "ticket_1",
    });
    expect(backend.websocketTicket).toHaveBeenCalledWith("https://api.example/auth", "fresh-ticket-token", "match_account01");
  });
});
