# Changelog

Notable changes to the Assalto Reale web client. The canonical application
version is `web/package.json`'s `version`; the UI version line and release
metadata derive from it.

## Unreleased

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
  build/smoke and production-audit gates. Invite multiplayer is now Phase C.9.

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
