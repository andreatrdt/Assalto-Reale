// Plain-Node smoke: build the runtime, compose it with in-memory persistence,
// bind an ephemeral port and confirm the HTTP surface (health + guest session)
// works end to end. No database required, so this runs anywhere.
import { createInMemoryPersistence } from "@assalto-reale/authoritative-server";
import { composeServer, loadConfig } from "../dist/index.js";

const ORIGIN = "http://localhost:5173";

const config = loadConfig({
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused",
  MULTIPLAYER_ALLOWED_ORIGINS: ORIGIN,
  GUEST_SESSION_SECRET: "server-runtime-smoke-secret-0123456789abcd",
});

const { server } = composeServer({
  config,
  persistence: createInMemoryPersistence(),
});
const address = await server.listen({ host: "127.0.0.1", port: 0 });
const base = `http://127.0.0.1:${address.port}`;

try {
  const health = await fetch(`${base}/healthz`);
  if (health.status !== 200)
    throw new Error(`healthz returned ${health.status}`);

  const ready = await fetch(`${base}/readyz`);
  if (ready.status !== 200) throw new Error(`readyz returned ${ready.status}`);

  const session = await fetch(`${base}/session`, {
    method: "POST",
    headers: { origin: ORIGIN },
  });
  if (session.status !== 201)
    throw new Error(`POST /session returned ${session.status}`);
  const body = await session.json();
  if (!body.token || !body.playerId || !body.sessionId)
    throw new Error("guest session payload is incomplete");

  const forbidden = await fetch(`${base}/session`, {
    method: "POST",
    headers: { origin: "https://evil.example" },
  });
  if (forbidden.status !== 403)
    throw new Error(
      `disallowed origin was not rejected (got ${forbidden.status})`,
    );

  console.log("server-runtime smoke passed");
} finally {
  await server.close();
}
