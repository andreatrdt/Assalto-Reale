import {
  BearerTokenConnectionAuthenticator,
  ContextualAuthenticator,
  createAuthoritativeTransportServer,
} from "../dist/index.js";

const contextual = new ContextualAuthenticator();
const bearer = new BearerTokenConnectionAuthenticator({
  async verify(token) {
    return token === "smoke-token"
      ? { playerId: "player_smoke", sessionId: "session_smoke" }
      : null;
  },
});
const server = createAuthoritativeTransportServer({
  executor: {
    async execute() {
      return [];
    },
  },
  authenticateConnection: bearer,
  heartbeatIntervalMs: 0,
});

const principal = await contextual.run(
  { playerId: "player_smoke", sessionId: "session_smoke" },
  () => contextual.authenticate({}),
);
if (principal?.playerId !== "player_smoke") {
  throw new Error("Contextual authenticator smoke failed.");
}
const address = await server.listen();
if (address.port <= 0 || address.websocketPath !== "/ws") {
  throw new Error("Transport listen smoke failed.");
}
await server.close();
console.log("server-transport smoke ok");
