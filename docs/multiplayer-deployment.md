# Multiplayer deployment foundation (Phase C.9.5)

This document describes how to run the authoritative multiplayer backend as a
composed full-stack process. It is the operational counterpart to the tested
backend packages.

## Status (read this first)

| Capability                                                 | State                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| Application core, protocol, PostgreSQL adapter, transport  | **Implemented & tested** (packages)                       |
| Composed runnable server (`@assalto-reale/server-runtime`) | **Implemented & tested**                                  |
| Local full-stack via Docker Compose                        | **Containerized & documented**                            |
| Production container image                                 | **Buildable** (validated in CI)                           |
| Publicly deployed backend                                  | **Not deployed** — no external infrastructure provisioned |

The public web client still **fails closed**: without `VITE_MULTIPLAYER_WS_URL`
it shows "Server not configured" and online play stays disabled. Nothing in this
phase makes online play appear to work while actually running locally in the
browser.

## Architecture

The runtime is a thin composition root. It introduces no game rules, protocol,
authentication or persistence logic — those live in their packages:

```
game-core            → the only gameplay-rules authority
multiplayer-protocol → the only wire-contract authority
authoritative-server → commands, membership, idempotency, optimistic
                       concurrency, PostgreSQL repositories + migrations
server-transport     → HTTP/WebSocket, HMAC guest sessions
server-runtime       → composes the above into a runnable process (this phase)
```

## Endpoints

Served by the transport (`server-transport`):

- `POST /session` — issues a short-lived anonymous **guest session** (HMAC
  token + `playerId`/`sessionId`). CORS-guarded by the origin allowlist;
  responses are `Cache-Control: no-store`. The path is fixed at `/session`.
- WebSocket upgrade at `WEBSOCKET_PATH` (default `/ws`). The client authenticates
  with the guest token via `Authorization: Bearer <token>` or `?access_token=<token>`.
- `GET /healthz` — liveness (always `200` while the process is up).
- `GET /readyz` — readiness; returns `503` when PostgreSQL is unreachable.

## Environment variables

Durable registered accounts are an optional, fail-closed extension. See
[`account-auth-foundation.md`](account-auth-foundation.md) for the Auth0 owner
steps, endpoint flow, rollback, and browser variables. Railway must set
`AUTH_ENABLED=true`, `AUTH_ISSUER_URL`, `AUTH_AUDIENCE`, and
`AUTH_SESSION_ID_CLAIM` together; `AUTH_WEBSOCKET_TICKET_TTL_SECONDS` defaults to 60. With auth disabled, the deployed guest behavior is unchanged.

| Variable                            | Required              | Default                              | Notes                                                               |
| ----------------------------------- | --------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| `NODE_ENV`                          | no                    | `development`                        | `production` fails fast on weak/missing values                      |
| `HOST`                              | no                    | `0.0.0.0` (prod) / `127.0.0.1` (dev) | bind address                                                        |
| `PORT`                              | no                    | `8080`                               | 1–65535                                                             |
| `DATABASE_URL`                      | **yes**               | —                                    | `postgres://` / `postgresql://`. No in-memory fallback              |
| `MULTIPLAYER_ALLOWED_ORIGINS`       | **yes in production** | localhost:5173 (dev)                 | comma-separated origin allowlist                                    |
| `WEBSOCKET_PATH`                    | no                    | `/ws`                                | absolute path; `/session` is fixed                                  |
| `GUEST_SESSION_SECRET`              | **yes in production** | labelled dev placeholder             | HMAC secret, ≥ 32 bytes, never logged                               |
| `GUEST_SESSION_TTL_SECONDS`         | no                    | `43200` (12h)                        | 60 … 604800                                                         |
| `POST_GAME_RECONNECT_GRACE_SECONDS` | no                    | `30`                                 | 1 … 300; preserves post-game participation across brief disconnects |
| `HEARTBEAT_INTERVAL_MS`             | no                    | `30000`                              | WebSocket ping/cleanup                                              |
| `MAX_PAYLOAD_BYTES`                 | no                    | `65536`                              | inbound message cap                                                 |
| `MAX_BUFFERED_BYTES`                | no                    | `1048576`                            | per-socket backpressure cap                                         |
| `SHUTDOWN_GRACE_MS`                 | no                    | `10000`                              | force-close window on shutdown                                      |

Invalid URLs, ports, TTLs or origins cause a `ConfigError` and a non-zero exit
before any traffic is served. `SESSION_PATH` may only be `/session`.

## Local full stack (Docker Compose)

```bash
docker compose up --build
```

This starts PostgreSQL and the composed server (health-gated). Then run the web
client against it:

```bash
cd web
echo 'VITE_MULTIPLAYER_WS_URL=ws://127.0.0.1:8080/ws' > .env.local
npm run dev
```

The database persists in the `pgdata` volume across restarts. Wipe it with
`docker compose down -v`.

## Running the server without Docker

```bash
# 1. A reachable PostgreSQL and its URL in DATABASE_URL.
# 2. Build the backend packages and the runtime:
npm --prefix packages/server-runtime run build
# 3. Provide configuration (see packages/server-runtime/.env.example) and start:
cd packages/server-runtime
DATABASE_URL=postgresql://user:pass@localhost:5432/assalto \
GUEST_SESSION_SECRET=$(openssl rand -hex 24) \
MULTIPLAYER_ALLOWED_ORIGINS=http://localhost:5173 \
npm start
```

## Migrations

Migrations are applied automatically on startup (`runPostgresMigrations`), before
the server accepts traffic. They are idempotent and safe to run repeatedly, so no
separate migration step is required for a single-instance deployment. The
migration set is `POSTGRES_MIGRATIONS` in `@assalto-reale/authoritative-server`.

## Frontend configuration

- `VITE_MULTIPLAYER_WS_URL` — the backend WebSocket URL. Without it, online play
  is disabled (fails closed).
- The HTTP `/session` endpoint is derived from the WS URL (`ws→http`, `wss→https`)
  on the same origin, unless overridden with `VITE_MULTIPLAYER_SESSION_URL`.
- The browser origin serving the client must appear in the server's
  `MULTIPLAYER_ALLOWED_ORIGINS`.
- **Production requires TLS**: `wss://` and `https://` on an allowlisted origin.

## Shutdown behavior

`SIGINT`/`SIGTERM` trigger graceful shutdown: in-flight sockets are closed
(force-closed after `SHUTDOWN_GRACE_MS`), the HTTP server stops accepting
connections, and the PostgreSQL pool is drained. Shutdown is idempotent
(repeated signals are safe). A fatal startup failure exits non-zero.

## Security assumptions

- Guest sessions are **not accounts**: HMAC-SHA256 tokens (constant-time
  verification, enforced expiry) that provide reconnect identity within a browser
  session only.
- The production `GUEST_SESSION_SECRET` must be ≥ 32 bytes and is never logged;
  the development placeholder is rejected in production.
- Origin allowlisting guards both `/session` and the WebSocket upgrade.
- Payload-size and per-socket backpressure limits, plus heartbeat cleanup, bound
  resource use.
- Session responses are non-cacheable; error responses never disclose database
  or secret details.
- The container runs as a non-root user.
- The server is authoritative: client-provided state and client-generated setup
  seeds are never trusted (seeds are generated server-side).

## Troubleshooting

- **`/readyz` returns 503** — PostgreSQL is unreachable; check `DATABASE_URL` and
  the database health.
- **WebSocket upgrade returns 401** — missing/invalid/expired guest token; the
  client must `POST /session` first and pass the token.
- **`/session` or upgrade returns 403** — the browser origin is not in
  `MULTIPLAYER_ALLOWED_ORIGINS`.
- **Startup exits non-zero with a ConfigError** — the message names the offending
  variable.

## Production deployment checklist

- [ ] Managed PostgreSQL provisioned; `DATABASE_URL` set (TLS where available).
- [ ] `NODE_ENV=production`.
- [ ] `GUEST_SESSION_SECRET` = a fresh ≥ 32-byte random secret from a secret store
      (never committed, never logged).
- [ ] `MULTIPLAYER_ALLOWED_ORIGINS` = the exact production web origin(s).
- [ ] TLS terminated in front of the server; client uses `wss://` + `https://`.
- [ ] `VITE_MULTIPLAYER_WS_URL` in the web build points at the public `wss://` URL.
- [ ] Health/readiness wired to the platform's liveness/readiness probes.
- [ ] Container runs as non-root (already the image default).
- [ ] Backups/retention for the match database.
- [ ] A rollback plan (previous image tag) is available.

> Single-instance note: this phase targets one server instance. Horizontal
> scaling needs shared event fan-out (e.g. Postgres LISTEN/NOTIFY or a broker)
> because WebSocket subscriptions are held in process memory — a follow-up
> beyond C.9.5.
