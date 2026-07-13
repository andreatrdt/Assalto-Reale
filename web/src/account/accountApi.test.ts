import { afterEach, describe, expect, it, vi } from "vitest";
import { accountApi } from "./accountApi";

afterEach(() => vi.unstubAllGlobals());

describe("account HTTP client", () => {
  it("keeps access tokens in Authorization headers and parses session state", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            kind: "registered",
            user: { userId: "user_1", status: "active", email: null },
            playerId: "player_1",
            sessionId: "session_1",
            expiresAt: "2030-01-01T00:00:00.000Z",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(accountApi.establish("https://api.example/auth", "secret-access-token")).resolves.toMatchObject({
      playerId: "player_1",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example/auth/session",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret-access-token" }),
      }),
    );
  });

  it("surfaces user-safe expired and failed authentication states", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "session_revoked",
              message: "The registered session has ended. Sign in again.",
            }),
            { status: 401 },
          ),
      ),
    );
    await expect(accountApi.establish("https://api.example/auth", "expired")).rejects.toEqual(
      expect.objectContaining({ status: 401, code: "session_revoked" }),
    );
  });
});
