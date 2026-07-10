# Authoritative server application core

## Roadmap position

This document defines Phase C.8.1 of the Assalto Reale roadmap.

```text
Phase A                               completed
Phase B.5 Store decomposition         completed
Phase B.6 Pure game-core              completed
Phase B.7 Multiplayer protocol        completed
Phase C.8 Authoritative server
  C.8.1 Application core              delivered here
  C.8.2 PostgreSQL adapter            pending
  C.8.3 Transport adapter             pending
Phase C.9 Invite multiplayer          pending
```

C.8.1 deliberately stops before networking and database selection. It establishes the application/domain boundary that those adapters must call.

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

State-changing commands use optimistic concurrency. The repository adapter must reject a commit when the persisted version no longer matches the version read by the command. Match mutation and command receipt persistence are one atomic operation.

The in-memory adapter enforces the same contract used by the future PostgreSQL implementation, including concurrent exact-command replay and rejection of command-ID reuse with different semantics.

## Supported C.8.1 commands

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

`RequestSync` returns a canonical `MatchSnapshot` to a verified member without advancing match state. It is itself receipt-backed, so exact retries return the same event envelope.

Exact duplicate commands replay their original result. Reusing a command ID with a changed actor, target, expected version or payload returns `duplicate_command`. Two concurrent commands against the same match version cannot both commit.

## Package boundaries

`packages/authoritative-server` may depend only on:

- `@assalto-reale/game-core`;
- `@assalto-reale/multiplayer-protocol`;
- Node standard-library modules in tooling/tests.

It must not import React, Zustand, web UI modules, browser APIs, a transport framework, a database client or an authentication provider.

## Deferred adapters

### C.8.2 PostgreSQL

The database adapter must implement the existing repository and unit-of-work ports using transactions, unique command IDs, unique invite codes and compare-and-swap match versions.

### C.8.3 transport

HTTP/Socket.IO/WebSocket adapters must remain thin:

```text
receive -> authenticate -> CommandHandler.handle -> deliver returned envelopes
```

No transport adapter may reimplement rules, membership, idempotency or version checks.
