# Operational readiness — Assalto Reale multiplayer

Operational counterpart to [`multiplayer-deployment.md`](multiplayer-deployment.md).
This document covers what an operator needs to run the backend responsibly:
observability, health/readiness semantics, backups & restore, and error
reporting. It records behaviour as implemented plus the steps the repository
cannot verify on the owner's behalf (marked **Owner-verify**).

## Structured logging

The runtime emits one JSON object per line (`server-runtime/src/logger.ts`),
machine-parseable in any platform. Secrets (guest-session secret, tokens,
authorization headers) are never logged. Current coverage:

| Event | Level | Key fields |
| --- | --- | --- |
| Server startup / ready | info | mode, host, port, websocketPath, allowedOrigins |
| Development guest-secret in use | warn | — |
| Applying / applied database migrations | info | — |
| Database migration failed | error | error |
| Readiness check failed (DB unreachable) | error | error |
| PostgreSQL pool error | error | error |
| WebSocket connected / disconnected | info | playerId |
| WebSocket authentication rejected | warn | reason (never the token) |
| Guest-session issuance failed | error | error |
| WebSocket command processing failed | error | playerId, error |
| Graceful shutdown start / complete | info | signal |

`playerId` is an anonymous guest identifier (`player_<random>`), not personal
data. Per-frame/per-render logging is deliberately avoided.

**Owner-verify:** confirm Railway is capturing stdout and that log retention is
adequate for incident review.

## Health and readiness

Two endpoints served by the transport (see `multiplayer-deployment.md`):

- `GET /healthz` — **liveness**: the process is up and the event loop responds.
  It does not touch PostgreSQL, so a DB outage does not flap liveness.
- `GET /readyz` — **readiness**: runs the readiness probe, which executes
  `SELECT 1` against the PostgreSQL pool. A DB failure makes `/readyz` return
  non-ready, so the platform can stop routing traffic while liveness stays green.

Startup fails fast: the runtime runs `SELECT 1` and applies migrations **before**
listening, so a bad DB or a failed migration prevents the process from serving
and is logged as an error (visible as a fatal startup failure).

These semantics are correct as-is; do not change them without a concrete defect.

## Where production data lives

- Canonical match state, command receipts, and event streams live in the
  **Railway-managed PostgreSQL** instance referenced by `DATABASE_URL`.
- The browser holds only *local resume hints* (`sessionStorage`): the active
  match id / invite / side and any pending create-join intent. These are
  recoverable convenience state, never the source of truth.
- There is **no** separate object store; a PostgreSQL backup is a full backup.

## Backups

**Owner-verify:** Railway PostgreSQL backup availability and cadence depend on the
plan and must be confirmed in the Railway dashboard (Database → Backups). Do not
assume automated backups exist until verified there. This repository does not
configure or schedule backups.

### Manual logical backup

From a machine with `pg_dump` and the production `DATABASE_URL` (read from Railway
variables — never commit it):

```bash
pg_dump --format=custom --no-owner --no-privileges \
  "$DATABASE_URL" > assalto-$(date +%Y%m%d-%H%M%S).dump
```

`--format=custom` yields a compressed archive restorable with `pg_restore`.

## Restore (into a non-production environment)

**Never restore directly onto the production database.** Restore into a scratch
database and inspect it first.

```bash
# 1. Create an empty scratch database (local or a disposable Railway DB).
createdb assalto_restore_check

# 2. Restore the dump into it.
pg_restore --no-owner --no-privileges \
  --dbname="postgresql://…/assalto_restore_check" assalto-YYYYMMDD-HHMMSS.dump

# 3. Verify (see below), then discard the scratch database.
dropdb assalto_restore_check
```

### Verifying a restore

- The expected tables exist and the migration bookkeeping table shows every
  migration as applied with matching checksums (migrations are checksum-verified
  and advisory-locked; a mismatch is a corruption signal).
- Row counts for matches / receipts / events are plausible (non-zero on a
  populated backup).
- Point the runtime at the scratch DB with `DATABASE_URL` and confirm `/readyz`
  returns ready and startup migrations report "already applied" (no re-apply).

### Migration considerations

- Migrations run automatically at startup, are idempotent, and are guarded by an
  advisory lock, so a rolling deploy will not double-apply.
- Restore a dump taken at schema version **N** only into code at version **N or
  newer**; newer code migrates the restored data forward on first boot. Do not
  run older code against a newer schema.

## Error reporting

Client render-time exceptions are caught by a React error boundary
(`web/src/app/ErrorBoundary.tsx`) that shows a plain reload / return-home
fallback instead of a white screen; the error is logged to the browser console
only. There is **no** third-party error-reporting service, and none is added
here.

**Future option (not integrated):** Sentry (or equivalent) could report
`componentDidCatch` from the boundary and backend `error`-level logs. It requires
an account, a DSN, and a data-privacy review, so it is intentionally deferred and
must be a deliberate decision, not a silent default.
