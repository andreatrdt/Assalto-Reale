import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  BearerTokenConnectionAuthenticator,
  ContextualAuthenticator,
  bindCommandHandler,
} from "../src/index.js";

const envelope = {} as never;

describe("transport authentication bridge", () => {
  it("returns no principal outside a transport context", async () => {
    const authenticator = new ContextualAuthenticator();
    await expect(authenticator.authenticate(envelope)).resolves.toBeNull();
  });

  it("isolates concurrent principal contexts and returns copies", async () => {
    const authenticator = new ContextualAuthenticator();
    const alice = { playerId: "player_alice", sessionId: "session_alice" };
    const bob = { playerId: "player_bob0001", sessionId: "session_bob0001" };

    const [aliceResult, bobResult] = await Promise.all([
      authenticator.run(alice, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return authenticator.authenticate(envelope);
      }),
      authenticator.run(bob, () => authenticator.authenticate(envelope)),
    ]);

    expect(aliceResult).toEqual(alice);
    expect(bobResult).toEqual(bob);
    expect(aliceResult).not.toBe(alice);
    await expect(authenticator.authenticate(envelope)).resolves.toBeNull();
  });

  it("binds the handler to the contextual principal", async () => {
    const authenticator = new ContextualAuthenticator();
    const handle = vi.fn(async () => []);
    const executor = bindCommandHandler({ handle }, authenticator);
    const principal = {
      playerId: "player_alice",
      sessionId: "session_alice",
    };

    await executor.execute(principal, { commandId: "command_0001" });

    expect(handle).toHaveBeenCalledWith({ commandId: "command_0001" });
    await expect(authenticator.authenticate(envelope)).resolves.toBeNull();
  });

  it("parses and delegates provider-neutral bearer tokens", async () => {
    const verify = vi.fn(async (token: string) => ({
      playerId: `player_${token}`,
      sessionId: `session_${token}`,
    }));
    const authenticator = new BearerTokenConnectionAuthenticator({ verify });
    const request = {
      headers: { authorization: "  Bearer token123  " },
    } as IncomingMessage;

    await expect(authenticator.authenticate(request)).resolves.toEqual({
      playerId: "player_token123",
      sessionId: "session_token123",
    });
    expect(verify).toHaveBeenCalledWith("token123", request);
  });

  it("rejects absent and malformed bearer headers", async () => {
    const verify = vi.fn();
    const authenticator = new BearerTokenConnectionAuthenticator({ verify });

    await expect(
      authenticator.authenticate({ headers: {} } as IncomingMessage),
    ).resolves.toBeNull();
    await expect(
      authenticator.authenticate({
        headers: { authorization: "Basic abc" },
      } as unknown as IncomingMessage),
    ).resolves.toBeNull();
    await expect(
      authenticator.authenticate({
        headers: { authorization: ["Bearer a", "Bearer b"] },
      } as unknown as IncomingMessage),
    ).resolves.toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });
});
