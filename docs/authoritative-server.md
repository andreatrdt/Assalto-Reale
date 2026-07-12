# Authoritative server

## Roadmap position

This document defines the delivered authoritative stack through Phase C.9.

```text
Phase A                               completed
Phase B.5 Store decomposition         completed
Phase B.6 Pure game-core              completed
Phase B.7 Multiplayer protocol        completed
Phase C.8 Authoritative server
  C.8.1 Application core              completed
  C.8.2 PostgreSQL adapter            completed
  C.8.3 Transport adapter             completed
Phase C.9 Invite multiplayer          completed
Phase C.10 Accounts/continuity        next
```

C.8 established the application, persistence and HTTP/WebSocket boundaries. C.9
adds anonymous browser session bootstrap and a client that consumes the existing
public contracts without changing command semantics or gameplay rules.

## Authority model

```text
web client
  obtains a short-lived anonymous credential
  proposes a versioned protocol command
  renders only canonical server snapshots

server-transport
  authenticates the HTTP/WebSocket connection
  supplies the connection principal
  forwards commands and routes returned envelopes

authoritative server application core
  validates identity, idempotency, membership and match version
  invokes game-core
  commits canonical state and the command receipt atomically
  emits canonical multiplayer-protocol events

PostgreSQL adapter
  persists the canonical aggregate and exact command result
  enforces unique command IDs and invite codes
  performs compare-and-swap match updates

game-core
  remains the only owner of gameplay rules
```

The client never supplies canonical state, generated IDs or setup seeds. Client
timestamps are diagnostics only. Selection highlights are presentation; they do
not commit an online move.

## Command pipeline

For every authenticated command, `CommandHandler` performs:

1. runtime validation through `multiplayer-protocol`;
2. transport-principal authentication;
3. principal/actor identity comparison;
4. semantic `commandId` idempotency lookup;
5. transactional aggregate load;
6. invite, membership and expected-version validation;
7. protocol-to-core translation where applicable;
8. `game-core` execution;
9. atomic aggregate and receipt persistence;
10. ordered event-envelope creation.

A semantic command fingerprint includes protocol version, player identity, target
match, expected match version and command payload. It excludes diagnostic send
time and session ID so a player can retry the same command after reconnecting.

## Aggregate and concurrency

`MatchAggregate` stores canonical `game-core` state, match ID, invitation code,
server-generated seed, Black/White membership, lifecycle status, monotonic
`version`, monotonic `streamSequence` and terminal reason.

State-changing commands use optimistic concurrency:

```sql
UPDATE authoritative_matches
SET version = :next_version, ...
WHERE match_id = :match_id AND version = :expected_version;
```

A zero-row update raises `ConcurrencyConflictError`; two commands that read the
same version cannot both commit.

## PostgreSQL schema

The versioned migration runner creates three tables.

### `authoritative_schema_migrations`

Records migration version, name, checksum and application time. A PostgreSQL
advisory lock serializes startup migration attempts and applied checksums prevent
silent edits to released migrations.

### `authoritative_matches`

Stores canonical match metadata and validated `game-core` state as JSONB,
including unique invite code, version, stream sequence, seed, config, membership,
lifecycle status and timestamps.

State is encoded with `game-core.serializeState` and accepted only through
`game-core.deserializeState`. Match configuration and stored protocol envelopes
are runtime-validated before entering the application layer.

### `authoritative_command_receipts`

Stores unique command IDs, authenticated player IDs, resolved match IDs, semantic
fingerprints and exact emitted envelopes. Rejected commands may reference missing
matches, so receipts intentionally do not require a match foreign key.

## Atomic commit order

```text
BEGIN
  claim command receipt with INSERT ... ON CONFLICT DO NOTHING
  compare an existing receipt when the command ID is already claimed
  insert a new match or compare-and-swap the existing match version
COMMIT
```

Receipt claiming before match mutation guarantees exact concurrent retry replay,
changed command-ID rejection, rollback after later conflicts and no partially
committed state/result pair.

## Supported commands

Application-level:

- `CreateMatch`
- `JoinMatch`
- `RequestSync`
- `Resign`

Mapped directly to `game-core`:

- `PlacePiece`
- `SubmitAction`
- `ChooseDefender`
- `CancelDefendedKing`
- `ChooseTransform`
- `PassTurn`

### Rematch lifecycle

A rematch is a **new authoritative match between the same two players**, never a
mutation of the completed one. Once a match is terminal:

- `OfferRematch` (by a member) records an open offer and emits `RematchOffered` to
  the opponent. Offering again is a no-op re-notify; a non-terminal match, or a
  non-member, is rejected (`illegal_command` / `unauthorized`).
- `RespondToRematch { accept: true }` (by the opponent only) creates the
  successor match; `{ accept: false }` clears the offer and emits
  `RematchDeclined`. The offerer cannot answer their own offer. If the opponent
  also sends `OfferRematch` instead of responding, that second offer accepts —
  so near-simultaneous mutual requests still yield exactly one rematch.
- The successor is a fresh aggregate: new `matchId`, new invite code, `version`
  and `streamSequence` reset to 1, an empty manual-placement board, the same two
  memberships with **sides swapped**, `predecessorMatchId` set to the old match,
  and no inherited history/result/clock. The completed match records
  `successorMatchId` (unique) so **at most one** successor can ever exist, even
  under duplicate or concurrent acceptance — a second acceptance simply re-emits
  the same `RematchCreated`.
- Both aggregates are persisted in one transaction (create successor +
  optimistic-version update of the completed match).
- `RequestSync` on a completed match that has a successor returns
  `RematchCreated` (with the new snapshot + the caller's assigned side), so a
  client that was offline during creation discovers and enters the new match on
  reconnect. Stale gameplay commands against the completed match are still
  rejected (`match_ended` / `stale_match_version`).

## Guest sessions

C.9 adds `HmacGuestSessionService` and optional `POST /session` support to the
transport package. Each credential contains a protocol-valid player ID, session
ID and expiry, signed with HMAC-SHA256. Verification rejects malformed, tampered
or expired tokens using constant-time signature comparison.

`GuestSessionConnectionAuthenticator` accepts the token through a Bearer header
or the `access_token` WebSocket query parameter. The query path exists because
browser WebSocket constructors cannot set arbitrary authorization headers.

Guest sessions are browser-session identities, not accounts. Production must
provide a secret of at least 32 bytes outside source control, TLS and an explicit
allowed web origin.

## Reconnect and idempotency

`RequestSync` returns a canonical `MatchSnapshot` to a verified member without
advancing match state. It is receipt-backed, so exact retries return the same
event envelope.

Exact duplicate commands replay their original result. Reusing a command ID with
a changed actor, target, expected version or payload returns
`duplicate_command`. The transport sends player-addressed envelopes to every live
socket for that player; successful sync also subscribes a reconnecting socket to
future match broadcasts.

## Package boundaries

`packages/authoritative-server` owns application, domain and persistence concerns.
It may depend on `game-core`, `multiplayer-protocol`, `pg`, Node standard modules
and development tooling, but not browser or network frameworks.

`packages/server-transport` owns HTTP/WebSocket concerns and guest-session edge
authentication. It may depend on the public authoritative-server API,
multiplayer-protocol, Node modules and `ws`, but not game rules, PostgreSQL,
React, Zustand, the web app, Socket.IO or identity-provider SDKs.

The React client consumes only the versioned protocol over the configured network
endpoint. See [`transport-adapter.md`](transport-adapter.md) and
[`invite-multiplayer.md`](invite-multiplayer.md).

## Validation

The dedicated server workflow runs independent authoritative/PostgreSQL and
transport jobs. Together they verify strict TypeScript, architecture boundaries,
formatting, coverage, PostgreSQL 16 integration, real HTTP/WebSocket behavior,
guest signing/bootstrap, ESM smoke and production dependency audits.

The web suite separately verifies guest storage, WebSocket lifecycle, reconnect,
command/event reduction, canonical projection, action-boundary restoration and
the visible online route.

## Next phase

Phase C.10 replaces browser-session-only identity with durable accounts and
cross-device continuity. Backend deployment, public matchmaking, ratings,
server-authoritative clocks remain separate work.

## Composed runtime (Phase C.9.5)

`packages/server-runtime` composes this application core (including its
PostgreSQL repositories and `runPostgresMigrations`) with the transport into a
runnable process. It does not reimplement commands, idempotency, concurrency or
persistence — it only wires the public exports. See
[`multiplayer-deployment.md`](multiplayer-deployment.md).
