# Changelog

Notable changes to the Assalto Reale web client. The canonical application
version is `web/package.json`'s `version`; the UI version line and release
metadata derive from it.

## Unreleased

Online lifecycle-command recovery & session-expiry hardening. Two lost-response
defects and one reconnect defect fixed, client-side only (the server's
command-receipt idempotency already reconstructs the original result — no
protocol, persistence, or migration change). (A/B) A `CreateMatch`/`JoinMatch`
whose authoritative response is lost is now recoverable: the exact command and its
`commandId` are persisted to `sessionStorage` **before** sending, and replayed with
the **same** commandId on reconnect, so the server replays the original
`MatchCreated`/`PlayerJoined` (recovering matchId, invite code, side, snapshot,
lifecycle status, version, stream) instead of creating a duplicate match/membership;
the intent is cleared only after the result is applied. (D) An expired guest token
no longer loops forever on close code 1006: the client uses the token's `expiresAt`
as the deterministic auth-failure signal, stops reconnecting when an expired token
guards an active match or pending intent, and surfaces an explicit "session expired"
state with "Start a new match" / "Return home" — never silently adopting a new
identity for the old match. A transient outage still reconnects. Documented in
[`docs/online-session-recovery.md`](docs/online-session-recovery.md), including the
standing limitation that anonymous memberships cannot survive identity expiry
without durable accounts (out of scope).

Online-match lifecycle audit hardening. Three confirmed canonical-state defects
fixed: (A) a lost command response after the server committed left
`pendingCommandId` stuck forever, deadlocking the client — a `MatchSnapshot` now
clears it, treating canonical synchronization as the authoritative resolution of
in-flight uncertainty (no blind resend; command-id receipts still guard any manual
retry). (D) event handling is now match-scoped: an event addressed to a different
match than the active one is ignored (only `RematchCreated` may introduce the
successor), so a late event from a previous match can no longer switch the client
back or overwrite the active successor. (E) the client no longer infers
`waitingForOpponent` from `matchVersion < 2` — a `MatchSnapshot` now carries the
authoritative lifecycle status (`awaitingOpponent`/`active`/`ended`), so
reconnecting into a rematch (version 1 with both players present) correctly opens
the board, and completion is restored from the snapshot. Protocol: `MatchSnapshot`
gains a required `status` field. No migration or persistence change.

Implemented server-authoritative online rematch. Previously the online "Rematch"
button routed to the local restart action (blocked during online play) and the
server rejected rematch commands, so a rematch never started. A rematch is now a
brand-new authoritative match between the same two players: one player requests
(`OfferRematch`), the opponent accepts (`RespondToRematch`), and the server
creates a fresh aggregate — new match ID, reset version/stream, empty
manual-placement board, swapped sides, `predecessorMatchId`/`successorMatchId`
lineage, and no inherited board/history/result. Exactly one successor is created
even under duplicate or concurrent acceptance; a reconnecting client that synced
the completed match is steered into the successor. Both clients switch into the
new match automatically with no new invite code or rejoin. The victory screen
shows Rematch / waiting / accept-decline / declined states; offline rematch is
unchanged and the two paths never mix. Adds a backward-compatible PostgreSQL
migration (`rematch_offered_by`, `successor_match_id`, `predecessor_match_id`).

Fixed online reconnect after a browser refresh. Two bugs kept the match on the
"Reconnect to your match" screen with "Synchronize Match" doing nothing: (1) the
client dropped the reconnect `MatchSnapshot` because its stream sequence equalled
the value persisted before the refresh, so the board never rehydrated; a
`MatchSnapshot` is now always applied (only incremental events are de-duplicated).
(2) `resumeMatch` only opened the socket and relied on the client's open handler
to send `RequestSync`, so on an already-open socket nothing was sent; reconnect is
now an explicit state machine (`idle → connecting → synchronizing → synchronized
→ failed`) that ensures exactly one `RequestSync`, times out with a clear retry
message, and auto-reconnects once on refresh. Navigation still waits for hydrated
canonical state, and placement/board/side/version are restored intact.

Removed the quick/preconfigured deployment from all production match creation:
every match — local, online invite, resumed, reconnected or restarted — now
always begins in the placement phase and transitions to gameplay only once
placement completes. The online `CreateMatch` config now requests manual
placement (was `QuickBalanced`), and the offline store no longer exposes or
defaults to any quick-start path (the unused `startQuickMatch`/`startAiMatch`/
`startTransformMatch` store actions were deleted and `startConfiguredMatch`
always forces manual placement). User-facing "Quick deployment/setup" labels were
replaced with manual-placement wording. `QuickBalanced` survives only as an
internal, test-only path (game-core/protocol fixtures and deserialization of
already-persisted matches and saves); no product flow can select or reach it.

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
