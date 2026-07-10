import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  GuestSessionConnectionAuthenticator,
  HmacGuestSessionService,
  createAuthoritativeTransportServer,
  type AuthoritativeTransportServer,
} from "../src/index.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const servers: AuthoritativeTransportServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("guest session HTTP bootstrap", () => {
  it("issues a CORS-safe guest token accepted by a browser-style WebSocket", async () => {
    let id = 0;
    const guestSessions = new HmacGuestSessionService(SECRET, {
      randomId: () => `guestidentifier${++id}`,
    });
    const server = createAuthoritativeTransportServer({
      executor: { execute: async () => [] },
      authenticateConnection: new GuestSessionConnectionAuthenticator(
        guestSessions,
      ),
      guestSessions,
      allowedOrigins: ["https://play.example"],
      heartbeatIntervalMs: 0,
    });
    servers.push(server);
    const address = await server.listen();
    const httpUrl = `http://127.0.0.1:${address.port}`;

    const preflight = await fetch(`${httpUrl}/session`, {
      method: "OPTIONS",
      headers: { origin: "https://play.example" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://play.example",
    );

    const response = await fetch(`${httpUrl}/session`, {
      method: "POST",
      headers: { origin: "https://play.example" },
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://play.example",
    );
    const session = (await response.json()) as {
      token: string;
      playerId: string;
      sessionId: string;
      expiresAt: string;
    };
    expect(session.playerId).toMatch(/^player_/);
    expect(session.sessionId).toMatch(/^session_/);
    expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now());

    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}${address.websocketPath}?access_token=${encodeURIComponent(session.token)}`,
      { origin: "https://play.example" },
    );
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it("rejects disallowed origins and hides the endpoint when disabled", async () => {
    const guestSessions = new HmacGuestSessionService(SECRET, {
      randomId: () => "guestidentifier1234",
    });
    const enabled = createAuthoritativeTransportServer({
      executor: { execute: async () => [] },
      authenticateConnection: new GuestSessionConnectionAuthenticator(
        guestSessions,
      ),
      guestSessions,
      allowedOrigins: ["https://play.example"],
      heartbeatIntervalMs: 0,
    });
    servers.push(enabled);
    const enabledAddress = await enabled.listen();
    const blocked = await fetch(
      `http://127.0.0.1:${enabledAddress.port}/session`,
      {
        method: "POST",
        headers: { origin: "https://blocked.example" },
      },
    );
    expect(blocked.status).toBe(403);

    const disabled = createAuthoritativeTransportServer({
      executor: { execute: async () => [] },
      authenticateConnection: { authenticate: async () => null },
      heartbeatIntervalMs: 0,
    });
    servers.push(disabled);
    const disabledAddress = await disabled.listen();
    expect(
      (
        await fetch(`http://127.0.0.1:${disabledAddress.port}/session`, {
          method: "POST",
        })
      ).status,
    ).toBe(404);
  });
});
