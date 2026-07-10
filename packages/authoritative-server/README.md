# @assalto-reale/authoritative-server

Authoritative application core and persistence adapters for Assalto Reale multiplayer.

The package accepts multiplayer-protocol command envelopes, authenticates an injected transport principal, applies the canonical `game-core`, persists match state and command receipts atomically, and returns ordered canonical protocol events.

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

The package does not contain game rules. It imports them only through `@assalto-reale/game-core`. It does not depend on React, Zustand, browser APIs, HTTP, WebSocket, Socket.IO or a production authentication provider.

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

## Implemented in C.8.2

- PostgreSQL implementation of `MatchRepository` and `UnitOfWork`;
- versioned, checksum-verified migrations protected by an advisory lock;
- canonical `game-core` state stored as validated JSONB;
- unique invitation codes and command IDs;
- exact command-envelope replay from persisted receipts;
- atomic receipt + match commits;
- compare-and-swap updates using the expected match version;
- deterministic rollback on persistence or concurrency failure;
- real PostgreSQL 16 integration coverage in CI.

Create a `pg.Pool`, apply migrations and pass the adapter to the existing command handler:

```ts
import { Pool } from "pg";
import {
  CommandHandler,
  createPostgresPersistence,
  runPostgresMigrations,
} from "@assalto-reale/authoritative-server";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await runPostgresMigrations(pool);

const persistence = createPostgresPersistence(pool);
const handler = new CommandHandler({
  matches: persistence.matches,
  unitOfWork: persistence.unitOfWork,
  authenticator,
  clock,
  ids,
  seeds,
});
```

The transport process owns pool startup and shutdown. The application core remains unaware of PostgreSQL.

## Deliberately deferred

- HTTP/Socket.IO transport: C.8.3;
- production authentication and accounts;
- rematch implementation and invite UI: C.9;
- server-authoritative clocks: C.11.

## Validation

Install the web toolchain and this package, provide a disposable PostgreSQL database, then run:

```bash
cd web
npm ci
cd ../packages/authoritative-server
npm ci
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/assalto_reale_test npm run test:coverage
npm run typecheck
npm run lint
npm run format:check
npm run smoke
npm run audit:prod
```

On PowerShell:

```powershell
$env:TEST_DATABASE_URL = "postgresql://user:password@localhost:5432/assalto_reale_test"
npm run test:coverage
```

The package consumes built public entry points from `game-core` and `multiplayer-protocol`; its scripts build those dependencies first. PostgreSQL tests are skipped only when `TEST_DATABASE_URL` is absent, while CI always supplies a real PostgreSQL 16 service.
