import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireGuestSession,
  authenticatedWebSocketUrl,
  clearGuestSession,
  loadGuestSession,
  saveGuestSession,
  sessionEndpointFor,
  type GuestSessionCredentials,
} from "./onlineIdentity";

const SESSION: GuestSessionCredentials = {
  token: "signed-token",
  playerId: "player_guest0001",
  sessionId: "session_guest001",
  expiresAt: "2030-01-01T00:00:00.000Z",
};

beforeEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("online guest identity", () => {
  it("derives HTTP session and authenticated WebSocket URLs", () => {
    expect(sessionEndpointFor("wss://games.example/ws?old=1")).toBe(
      "https://games.example/session",
    );
    expect(
      authenticatedWebSocketUrl("wss://games.example/ws", "a token"),
    ).toBe("wss://games.example/ws?access_token=a+token");
  });

  it("round-trips a valid unexpired session through sessionStorage", () => {
    saveGuestSession(SESSION);
    expect(loadGuestSession(Date.parse("2029-01-01T00:00:00.000Z"))).toEqual(
      SESSION,
    );
    clearGuestSession();
    expect(loadGuestSession()).toBeNull();
  });

  it("removes expired or malformed cached credentials", () => {
    saveGuestSession({
      ...SESSION,
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    expect(loadGuestSession(Date.parse("2026-01-01T00:00:00.000Z"))).toBeNull();

    window.sessionStorage.setItem("assalto:online-guest-session", "not-json");
    expect(loadGuestSession()).toBeNull();
  });

  it("acquires, validates and caches a server-issued session", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(SESSION), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      acquireGuestSession("ws://127.0.0.1:8080/ws", fetcher),
    ).resolves.toEqual(SESSION);
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/session",
      expect.objectContaining({ method: "POST" }),
    );

    await acquireGuestSession("ws://127.0.0.1:8080/ws", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed for an invalid server response", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ token: "missing-principal" }), {
        status: 201,
      }),
    );
    await expect(
      acquireGuestSession("ws://127.0.0.1:8080/ws", fetcher),
    ).rejects.toThrow("invalid guest session");
  });
});
