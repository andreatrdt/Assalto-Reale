import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import {
  GuestSessionConnectionAuthenticator,
  HmacGuestSessionService,
} from "../src/index.js";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("anonymous guest sessions", () => {
  it("issues and verifies a short-lived signed principal", async () => {
    let now = Date.parse("2026-07-10T18:00:00.000Z");
    let id = 0;
    const service = new HmacGuestSessionService(SECRET, {
      now: () => now,
      ttlMs: 60_000,
      randomId: () => `guestidentifier${++id}`,
    });

    const issued = await service.issue();
    expect(issued.playerId).toBe("player_guestidentifier1");
    expect(issued.sessionId).toBe("session_guestidentifier2");
    await expect(service.verify(issued.token)).resolves.toEqual({
      playerId: issued.playerId,
      sessionId: issued.sessionId,
    });

    now += 60_001;
    await expect(service.verify(issued.token)).resolves.toBeNull();
  });

  it("rejects changed signatures and malformed payloads", async () => {
    const service = new HmacGuestSessionService(SECRET, {
      randomId: () => "guestidentifier1234",
    });
    const issued = await service.issue();
    const changed = `${issued.token.slice(0, -1)}${issued.token.endsWith("a") ? "b" : "a"}`;

    await expect(service.verify(changed)).resolves.toBeNull();
    await expect(service.verify("not-a-token")).resolves.toBeNull();
  });

  it("reads browser query tokens and Bearer headers", async () => {
    const service = new HmacGuestSessionService(SECRET, {
      randomId: () => "guestidentifier1234",
    });
    const issued = await service.issue();
    const authenticator = new GuestSessionConnectionAuthenticator(service);

    await expect(
      authenticator.authenticate({
        url: `/ws?access_token=${encodeURIComponent(issued.token)}`,
        headers: {},
      } as IncomingMessage),
    ).resolves.toEqual({
      playerId: issued.playerId,
      sessionId: issued.sessionId,
    });

    await expect(
      authenticator.authenticate({
        url: "/ws",
        headers: { authorization: `Bearer ${issued.token}` },
      } as IncomingMessage),
    ).resolves.toEqual({
      playerId: issued.playerId,
      sessionId: issued.sessionId,
    });
  });

  it("rejects weak secrets", () => {
    expect(() => new HmacGuestSessionService("too-short")).toThrow(
      "at least 32 bytes",
    );
  });
});
