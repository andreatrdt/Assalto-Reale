# Authoritative server

## Roadmap position

This document defines the delivered authoritative-server foundation through Phase C.8.2.

```text
Phase A                               completed
Phase B.5 Store decomposition         completed
Phase B.6 Pure game-core              completed
Phase B.7 Multiplayer protocol        completed
Phase C.8 Authoritative server
  C.8.1 Application core              completed
  C.8.2 PostgreSQL adapter            delivered here
  C.8.3 Transport adapter             pending
Phase C.9 Invite multiplayer          pending
```

C.8.1 established the transport- and database-independent application boundary. C.8.2 implements its existing persistence ports with PostgreSQL without changing command semantics or game rules.

## Authority model

```text
client
  proposes a versioned protocol command

transport/auth adapter
  authenticates the connection and supplies a principal

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

The versioned migration runner creates three tables:

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

Stores:

- unique `command_id`;
- authenticated `player_id`;
- resolved match ID where applicable;
- semantic payload fingerprint;
- exact emitted event envelopes as JSONB.

Receipts intentionally do not have a match foreign key because rejected commands may refer to a missing or invalid match ID and must still be retry-safe.

## Atomic commit order

The PostgreSQL `UnitOfWork` opens one database transaction and stages writes while the application callback runs. Commit order is:

```text
BEGIN
  claim command receipt with INSERT ... ON CONFLICT DO NOTHING
  compare an existing receipt when the command ID is already claimed
  insert a new match or compare-and-swap the existing match version
COMMIT
```

Receipt claiming happens before match mutation. This guarantees:

- an exact concurrent retry replays the already-committed envelopes;
- changed reuse of a command ID raises `ReceiptConflictError`;
- a later match conflict rolls the new receipt back;
- match state and command result never commit partially.

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

## Package boundaries

`packages/authoritative-server` may depend only on:

- `@assalto-reale/game-core`;
- `@assalto-reale/multiplayer-protocol`;
- `pg` for the PostgreSQL adapter;
- Node standard-library modules and development tooling.

It must not import React, Zustand, web UI modules, browser APIs, an HTTP/WebSocket framework or a production authentication provider.

## Validation

The dedicated server CI starts PostgreSQL 16 and runs:

- strict TypeScript typecheck;
- architecture lint;
- Prettier verification;
- application, in-memory and PostgreSQL integration tests with coverage thresholds;
- ESM build and plain-Node smoke test;
- production dependency audit.

PostgreSQL integration coverage verifies migrations, canonical round-trip, invitation lookup, exact-retry replay, changed command-ID rejection, atomic rollback, compare-and-swap concurrency and persisted-data validation.

## Next adapter: C.8.3 transport

HTTP/Socket.IO/WebSocket adapters must remain thin:

```text
receive -> authenticate -> CommandHandler.handle -> deliver returned envelopes
```

No transport adapter may reimplement rules, membership, idempotency, version checks or database transactions.
