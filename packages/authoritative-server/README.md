# @assalto-reale/authoritative-server

Transport- and database-independent application core for Assalto Reale multiplayer.

This package is the first checkpoint of Phase C.8. It accepts validated multiplayer-protocol command envelopes, authenticates an injected transport principal, applies the canonical `game-core`, persists match state and command receipts atomically, and returns ordered canonical protocol events.

## Authority boundaries

```text
client command
  -> multiplayer-protocol validation
  -> authenticated principal check
  -> idempotency receipt check
  -> match membership and expected-version check
  -> game-core command
  -> atomic match + receipt commit
  -> canonical protocol events
```

The package does not contain game rules. It imports them only through `@assalto-reale/game-core`. It does not depend on React, Zustand, browser APIs, HTTP, WebSocket, Socket.IO, PostgreSQL or an authentication provider.

## Implemented in C.8.1

- server-generated match IDs, invite codes and deterministic setup seeds;
- authoritative `MatchAggregate` with membership, lifecycle, version and stream sequence;
- protocol validation and actor/principal matching;
- semantic command idempotency, including concurrent retries;
- optimistic match-version enforcement;
- game-command translation to `game-core`;
- ordered `MatchUpdated`, `TurnChanged`, `DecisionRequired` and `MatchEnded` events;
- invite-code join, resignation and reconnect-safe `RequestSync`;
- transaction/repository ports and an atomic in-memory adapter;
- structured rejections and architecture-boundary tests.

## Deliberately deferred

- PostgreSQL and migrations: C.8.2;
- HTTP/Socket.IO transport: C.8.3;
- production authentication and accounts;
- rematch implementation and invite UI: C.9;
- server-authoritative clocks: C.11.

## Validation

Install the web toolchain and this package, then run:

```bash
cd web
npm ci
cd ../packages/authoritative-server
npm install
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run smoke
npm run audit:prod
```

The package consumes built public entry points from `game-core` and `multiplayer-protocol`; the scripts build those dependencies first.
