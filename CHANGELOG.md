# Changelog

Notable changes to the Assalto Reale web client. The canonical application
version is `web/package.json`'s `version`; the UI version line and release
metadata derive from it.

## Unreleased

Fixed join-by-invite-code, which failed on the first real two-device match with
`expectedMatchVersion: JoinMatch requires a matchId and no expected version.` The
joining device only knows the invite code, not the `matchId`, so it sends
`JoinMatch` with `matchId = null` — the exact shape the authoritative server was
built to resolve (it loads by `matchId` when present, otherwise resolves the
invite). The shared protocol validator wrongly required a non-null `matchId` for
`JoinMatch`, so `encodeClientMessage` threw before the command was ever sent.
Validation now accepts an invite-code `JoinMatch` with no `matchId` (still
forbidding an expected version); the wire shape, server authority, idempotency,
expected-version semantics and reconnect are unchanged. Regression coverage added
across the protocol consumers (authoritative core resolves by invite, the composed
stack joins with the code only, and the browser client encodes a null-`matchId`
`JoinMatch`).

Operational multiplayer runtime (Phase C.9.5) — turns the tested backend packages
into one runnable, containerized full-stack server. No accounts, matchmaking,
timers or game rules. The backend is now locally runnable and container-buildable
but is **not** publicly deployed. See
[`docs/multiplayer-deployment.md`](docs/multiplayer-deployment.md).

- Added `@assalto-reale/server-runtime`, a composition root that wires the
  authoritative application core (commands, membership, idempotency, optimistic
  concurrency, PostgreSQL repositories + migrations) to the HTTP/WebSocket
  transport and HMAC guest sessions. It adds no game rules, protocol,
  authentication or persistence logic of its own.
- Validated fail-fast configuration (production rejects weak/missing guest
  secret, missing origin allowlist and non-postgres `DATABASE_URL`; secrets are
  never logged); crypto-backed clock/id/seed ports; structured JSON logging; a
  production `createRuntime` (pool, automatic migrations, DB readiness probe,
  graceful idempotent shutdown, non-zero exit on fatal startup).
- Added a multi-stage Dockerfile (non-root, healthchecked), root
  `docker-compose.yml` (PostgreSQL + server, health-gated), `.dockerignore`, and
  `packages/server-runtime/.env.example` + `web/.env.example`.
- Added a real composed-stack integration (HTTP guest sessions + two WebSocket
  clients + gameplay + reconnect) over in-memory persistence, plus a
  PostgreSQL-backed runtime integration gated on `TEST_DATABASE_URL`; config,
  architecture-boundary and logger tests; a plain-Node smoke.
- Extended `server-ci.yml` with a `server-runtime` job: strict typecheck, lint,
  formatting, PostgreSQL-backed coverage, Node smoke, production audit and a
  Docker image build.
- Fixed the PostgreSQL-backed runtime integration, which fed an out-of-range
  `PORT=0` to the fail-fast config loader (`loadConfig` requires `1–65535`, by
  contract). It threw in `beforeAll` before the database ran — invisible locally
  (the test is `TEST_DATABASE_URL`-gated) but failing the coverage step in CI and
  skipping the smoke, audit and Docker steps. The test now binds an OS-assigned
  ephemeral port without weakening the config contract; the full `server-runtime`
  job (PostgreSQL integration, smoke, audit, Docker build) passes.

Invite-based untimed multiplayer — completes Phase C.9 at the code and validation
level. The online UI is visible in the web client; a deployed and configured
backend is still required for public online matches. See
[`docs/invite-multiplayer.md`](docs/invite-multiplayer.md).

- Added **Play Online** and **Resume Online Match** entry points, private host and
  join-by-code cards, a shareable invite waiting room and responsive connection
  status UX.
- Added a reconnecting browser WebSocket client with persistent browser-session
  identity, command ordering, exponential retry and canonical `RequestSync`.
- Added canonical snapshot projection into the existing board UI and an online
  action bridge for placement, movement, Defended King, Transform, pass and
  resignation while preventing local undo/save/load/import from becoming online
  authority.
- Added short-lived HMAC-signed anonymous guest sessions, optional `POST /session`
  CORS bootstrap and browser-compatible query-token WebSocket authentication.
- Added structured pending-command, rejection, side/turn and reconnect feedback,
  plus an in-game server-version/status HUD and resignation confirmation.
- Added focused client/store/projection/guest-session tests and Playwright online
  route coverage. The web suite now has 308 passing tests and retains the existing
  global coverage thresholds.
- Preserved local Human-v-Human and Human-v-Computer behavior. Accounts,
  cross-device identity, deployment, matchmaking, ratings and timed online play
  remain later phases.

Authoritative HTTP/WebSocket transport — completes Phase C.8.3 without selecting
a production identity provider, deployment platform or multiplayer UI. See
[`docs/transport-adapter.md`](docs/transport-adapter.md).

- Added `packages/server-transport`, a thin Node HTTP/WebSocket edge that consumes
  only the public authoritative-server and multiplayer-protocol APIs.
- Added liveness/readiness endpoints, authenticated upgrades, provider-neutral
  bearer verification and async connection-principal propagation into the
  existing `CommandHandler` authentication port.
- Added serialized per-connection command handling, match and player recipient
  routing, reconnect-safe subscriptions, origin and payload controls,
  backpressure protection, heartbeat cleanup and graceful shutdown.
- Added real-WebSocket integration coverage for connection authentication,
  invalid messages, actor spoofing, create/join, reconnect sync, broadcasts,
  command ordering and shutdown.
- Split permanent server CI into independent authoritative/PostgreSQL and
  transport jobs, each with strict typecheck, architecture, formatting, coverage,
  build/smoke and production-audit gates.

Authoritative PostgreSQL persistence — completes Phase C.8.2 without adding a
network transport, production authentication provider or multiplayer UI. See
[`docs/authoritative-server.md`](docs/authoritative-server.md).

- Added a PostgreSQL implementation of the existing `MatchRepository` and
  transactional `UnitOfWork` ports; the application/domain core remains
  database-independent.
- Added versioned, checksum-verified migrations protected by a PostgreSQL
  advisory lock, with canonical match state and command envelopes stored as
  validated JSONB.
- Added unique command-ID and invite-code enforcement, exact retry replay,
  compare-and-swap version updates and atomic receipt + match commits.
- Added real PostgreSQL integration coverage for migration idempotency,
  round-trip loading, invitation lookup, concurrent retries, conflicting
  command IDs, optimistic-concurrency races, rollback and corrupt-data guards.
- Extended dedicated server CI with a PostgreSQL 16 service while keeping the
  complete Python, parity, web, browser and build baseline unchanged.

Authoritative server application core — completes Phase C.8.1 without adding a
network transport, database, production authentication provider or multiplayer
UI. See [`docs/authoritative-server.md`](docs/authoritative-server.md).

- Added `packages/authoritative-server`, a strict Node/TypeScript application and
  domain layer consuming the public `game-core` and `multiplayer-protocol`
  packages rather than duplicating rules or wire types.
- Added authoritative match creation/join, server-owned deterministic seeds,
  principal/actor checks, membership and expected-version enforcement,
  protocol→core translation, resignation and canonical `RequestSync` snapshots.
- Added semantic command idempotency and an atomic unit-of-work contract: exact
  retries replay the original envelopes, conflicting command-ID reuse is
  rejected, and concurrent commands cannot both commit the same match version.
- Added repository/transaction ports, a deterministic in-memory adapter, ordered
  event streams, structured rejection mapping and architecture-boundary tests.
- Added dedicated CI for strict typecheck, ESLint, Prettier, coverage thresholds,
  ESM build, plain-Node smoke and production dependency audit.

Baseline repair — restore a green repository after the game-core command-API
integration left `main` failing typecheck, unit tests and package smokes. No
game rules, protocol, UI, save-schema or public Zustand API behaviour changed.

- `packages/game-core` now re-exports its canonical match command API from the
  package entry point (`match`, `matchTypes`, `matchSetup`, `matchSerialization`
  in `index.ts` and `package.json` `exports`). These were implemented in PR #29
  but never exposed, so every consumer of `createMatch`/`applyCommand`/
  `getLegalActions`/`serializeState`/… failed to resolve.
- Fixed web fallout: `storeTypes.ts` referenced a non-existent
  `ResolvedMatchConfig` (now `MatchConfig`) and an incomplete `SavedGame` shape;
  `gameStore.ts` AI placement mistakenly used `chooseDeterministicAction`
  (restored to the Quick-Balanced placement heuristic + `PlacePiece`); the
  protocol compatibility test asserted an impossible bidirectional tuple
  equivalence (corrected to the real protocol→core assignability invariant).
- Green baseline: Python 44, parity 141, web unit 284, typecheck/lint/format,
  game-core + protocol typecheck and Node smokes, `audit:prod` 0, build and e2e.

Python ⇄ TypeScript parity (full turns & special mechanics) — extends the
randomness foundation with complete-turn and mechanic parity. No gameplay rules,
movement, capture, victory precedence, AI or save meaning changed; this phase is
tests, a fixture generator and docs only (no product source changes). See
[`docs/rules-parity-contract.md`](docs/rules-parity-contract.md).

- Added a sequence parity harness: the Python fixture generator records full
  step sequences (action/pass/transform/territory-refresh) threading action
  points and King-acted state; `sequenceParity.test.ts` replays each through the
  TypeScript engine, asserting the legal-action set, built action, transition
  result and a compact board snapshot at every step.
- New scenarios (55): 10 complete-turn, 7 Defended-King (defender choices,
  invalid defender, blocked bounce, landing on a Transform Square, range-2),
  3 Transform (relocation + no-relocation), 3 territory
  (create/progress/mature-to-victory, cancel-by-move, cancel-by-capture), 2
  victory (King capture, and precedence over a held territory majority), and 30
  deterministic seeded generated legal sequences.
- **No divergences found**: the TypeScript engine reproduced every Python
  reference value across all 55 scenarios; no engine bug fixes were needed.
- `parity:test` now also runs the sequence suite; the fixture generator emits a
  compact sparse-piece snapshot to keep the committed fixture manageable.
- Web unit tests 206 → 261; parity tests 86 → 141.

Python ⇄ TypeScript parity (randomness foundation) — a canonical rules-parity
contract plus a shared deterministic PRNG proven byte-identical across engines.
No gameplay rules, movement, capture, victory precedence, AI or save meaning
changed. See [`docs/rules-parity-contract.md`](docs/rules-parity-contract.md).

- Established a shared **Mulberry32** PRNG as the canonical randomness contract:
  `web/src/game/engine/random.ts` and `assalto_pygbag_ready/assalto_prng.py` are
  line-for-line equivalent (verified identical float streams).
- The Python reference engine (`assalto_core.py`) now generates Special and
  Transform Squares through the shared PRNG instead of `random.Random` (Mersenne
  Twister); the TypeScript Transform selection now uses a real seeded `choice`
  instead of `seed % length`. Seeded generation is now engine-identical.
- Save compatibility preserved: generated squares are persisted, so loading a
  save never re-rolls; the shared PRNG affects only newly created matches. No
  existing save changes meaning.
- Added cross-runtime proof `web/src/game/engine/randomParity.test.ts` (20 cases:
  raw PRNG stream + seeded Special/Transform generation) driven by Python-generated
  fixtures; web unit tests 186 → 206.
- Fixture pipeline: `npm run parity:generate` / `parity:check` (stale-fixture
  guard, never mutates the committed file) / `parity:test`, plus a dedicated CI
  `parity` job.
- Deferred (tracked in the contract): exhaustive complete-turn, Defended-King,
  Transform, territory/victory-precedence parity and property-based generated
  scenarios. Not yet complete engine equivalence.

Browser-quality hardening — accessibility, keyboard/focus, cross-browser,
responsive, reduced-motion/high-contrast, PWA/offline, runtime teardown and
real-UI save import/export. No gameplay rules, AI, timer semantics or the visual
design language changed. See
[`docs/browser-quality.md`](docs/browser-quality.md).
