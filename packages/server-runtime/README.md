# @assalto-reale/server-runtime

The composition root for the authoritative multiplayer backend (Phase C.9.5). It
turns the tested backend packages into one runnable full-stack server and owns no
game rules, protocol, authentication or persistence logic of its own.

It composes:

- [`@assalto-reale/authoritative-server`](../authoritative-server) — commands,
  membership, idempotency, optimistic concurrency, PostgreSQL repositories +
  migrations.
- [`@assalto-reale/server-transport`](../server-transport) — HTTP/WebSocket
  transport and HMAC guest sessions.

## Public API

- `loadConfig(env)` → validated `RuntimeConfig` (throws `ConfigError` on bad input).
- `composeServer({ config, persistence, … })` → a runnable transport server, for
  any persistence (used by tests with in-memory persistence).
- `createRuntime(config)` → the production runtime (`start()` / `stop()`): builds
  the PostgreSQL pool, runs migrations, wires a readiness probe and shuts down
  transport + pool gracefully and idempotently.
- `main()` — process entrypoint (invoked by `node dist/main.js`).
- `SystemClock`, `CryptoIdGenerator`, `CryptoSeedGenerator`, `createJsonLogger`.

## Run

```bash
npm run build
DATABASE_URL=postgresql://user:pass@localhost:5432/assalto \
GUEST_SESSION_SECRET=$(openssl rand -hex 24) \
MULTIPLAYER_ALLOWED_ORIGINS=http://localhost:5173 \
npm start
```

Or the full local stack from the repo root: `docker compose up --build`.

## Endpoints

`POST /session` (guest session), WebSocket at `WEBSOCKET_PATH` (default `/ws`),
`GET /healthz` (liveness), `GET /readyz` (readiness — 503 when the database is
unreachable).

## Configuration & deployment

See [`docs/multiplayer-deployment.md`](../../docs/multiplayer-deployment.md) for
the full environment-variable reference, migrations, security assumptions,
shutdown behavior, troubleshooting and the production checklist.
`.env.example` documents every variable.

## Scripts

`typecheck`, `build`, `start`, `test` / `test:coverage` (the PostgreSQL
integration runs when `TEST_DATABASE_URL` is set), `lint`, `format:check`,
`smoke` (plain-Node), `audit:prod`.

## Architecture boundaries (enforced by tests)

No browser, React or Zustand imports; game rules are reached only through the
application core (never a direct `game-core` import); the `pg` driver is confined
to the composition root.
