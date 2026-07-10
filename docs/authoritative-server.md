# Authoritative server

## Roadmap position

This document defines the delivered authoritative-server stack through Phase C.8.3.

```text
Phase A                               completed
Phase B.5 Store decomposition         completed
Phase B.6 Pure game-core              completed
Phase B.7 Multiplayer protocol        completed
Phase C.8 Authoritative server
  C.8.1 Application core              completed
  C.8.2 PostgreSQL adapter            completed
  C.8.3 Transport adapter             completed
Phase C.9 Invite multiplayer          next
```

C.8.1 established the application boundary, C.8.2 implemented durable PostgreSQL persistence, and C.8.3 added a thin authenticated HTTP/WebSocket edge without changing command semantics or game rules.

## Authority model

```text
client
  proposes a versioned protocol command

server-transport
  authenticates the WebSocket connection
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

The client never supplies canonical state, generated IDs or setup seeds. Client timestamps are diagnostics only.

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

A semantic command fingerprint includes protocol version, player identity, target match, expected match version and command payload. It intentionally excludes diagnostic send time and session ID so a player can retry the same command after reconnecting.

## Aggregate and concurrency

`MatchAggregate` stores:

- canonical `game-core` match state;
- match ID and invitation code;
- server-generated deterministic seed;
- Black/White membership;
- lifecycle status;
- monotonic `version`;
- monotonic `streamSequence`;
- terminal reason where applicable.

State-changing commands use optimistic concurrency. PostgreSQL updates include both the match ID and the version read by the command:

```sql
UPDATE authoritative_matches
SET version = :next_version, ...
WHERE match_id = :match_id AND version = :expected_version;
```

A zero-row update raises `ConcurrencyConflictError`. Therefore two commands that read the same version cannot both commit.

## PostgreSQL schema

The versioned migration runner creates three tables.

### `authoritative_schema_migrations`

Records migration version, name, checksum and application time. A PostgreSQL advisory lock serializes concurrent startup migration attempts. Applied migration checksums are verified so released migrations cannot be edited silently.

### `authoritative_matches`

Stores canonical match metadata and a validated `game-core` state snapshot:

- primary key `match_id`;
- unique `invite_code`;
- `version` and `stream_sequence`;
- server-generated `seed`;
- JSONB match configuration;
- Black and White player IDs;
- lifecycle status and terminal reason;
- JSONB canonical state;
- creation and update timestamps.

State is encoded with `game-core.serializeState` and validated with `game-core.deserializeState` when loaded. Match configuration and stored protocol envelopes are also runtime-validated before entering the application layer.

### `authoritative_command_receipts`

Stores unique command IDs, authenticated player IDs, resolved match IDs, semantic payload fingerprints and exact emitted event envelopes as JSONB. Receipts intentionally do not have a match foreign key because rejected commands may refer to missing or invalid matches and must still be retry-safe.

## Atomic commit order

```text
BEGIN
  claim command receipt with INSERT ... ON CONFLICT DO NOTHING
  compare an existing receipt when the command ID is already claimed
  insert a new match or compare-and-swap the existing match version
COMMIT
```

Receipt claiming happens before match mutation. This guarantees exact concurrent retry replay, rejection of changed command-ID reuse, rollback of receipts after later match conflicts, and no partially committed match/result pair.

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

`OfferRematch` and `RespondToRematch` remain protocol-valid but receive a structured `illegal_command` rejection until Phase C.9.

## Reconnect and idempotency

`RequestSync` returns a canonical `MatchSnapshot` to a verified member without advancing match state. It is receipt-backed, so exact retries return the same event envelope.

Exact duplicate commands replay their original result. Reusing a command ID with a changed actor, target, expected version or payload returns `duplicate_command`. Two concurrent commands against the same match version cannot both commit.

The transport sends player-addressed envelopes to all live sockets authenticated as that player. A successful `RequestSync` also subscribes a reconnecting socket to future match broadcasts.

## Package boundaries

`packages/authoritative-server` owns application, domain and persistence concerns. It may depend on `game-core`, `multiplayer-protocol`, `pg`, Node standard modules and development tooling, but not browser or network frameworks.

`packages/server-transport` owns only HTTP/WebSocket concerns. It may depend on the public authoritative-server API, multiplayer-protocol, Node HTTP modules and `ws`. It may not import game rules, PostgreSQL, React, Zustand, the web application, Socket.IO or an identity-provider SDK.

See [`transport-adapter.md`](transport-adapter.md) for the complete transport contract.

## Validation

The dedicated server workflow now runs two independent jobs.

The authoritative-server job starts PostgreSQL 16 and verifies strict TypeScript, architecture boundaries, formatting, application/in-memory/PostgreSQL coverage, ESM smoke and production dependencies.

The server-transport job verifies strict TypeScript, transport architecture boundaries, formatting, HTTP and real-WebSocket integration coverage, ESM smoke and production dependencies without requiring PostgreSQL.

## Next phase

Phase C.9 uses this completed backend stack to expose invite-based untimed multiplayer in the web client. Accounts, public matchmaking, ratings and server-authoritative clocks remain later work.
