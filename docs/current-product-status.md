# Assalto Reale — current product status

**This is the canonical source of truth for the current application.** Other
documents in `docs/` are design history or task-specific notes; where they
disagree with this file, this file wins. Last reconciled through the full-rules
parity, game-store decomposition, pure game-core, multiplayer protocol,
authoritative application core, PostgreSQL persistence, HTTP/WebSocket
transport and invite-multiplayer client passes (see `CHANGELOG.md`).

## What ships publicly

The public product is the modern **React + TypeScript + Vite** client under
`web/`, deployed to GitHub Pages at
`https://andreatrdt.github.io/Assalto-Reale/` (project-site base path
`/Assalto-Reale/`). All of the following are exposed and working in the
user-facing app (verified from implementation and tests):

- 12×12 board, Black versus White, one King + Attack/Defense/Conquest pawn each.
- **Human vs Human** and **Human vs Computer** local play.
- **Manual placement** (snake schedule) — the only public local placement mode.
- **Transform enabled** for every new public local match.
- **Timed and untimed** local matches (Untimed, 5/10/12/15/20 minutes).
- **Defended King** sacrifice-and-bounce, with an on-board preview and a
  contextual decision panel.
- **Victory** by king capture, territory majority and timeout, with an accessible
  victory overlay.
- **Undo**, **local save/load**, and **JSON import/export** for local matches.
- **Board-motion animations** and a synthesized audio layer with mute + volume.
- **Reduced-motion** and **high-contrast board** accessibility settings.
- Responsive **board-first** desktop and mobile layouts.
- Installable **PWA** with manifest, icons, service worker and SPA fallback.
- A visible **Play Online** route with private host/join choices, invite-code
  waiting room, reconnect status and an in-game server-authority HUD.

The GitHub Pages deployment does not currently provide
`VITE_MULTIPLAYER_WS_URL`, so its online route deliberately shows **Server not
configured** and disables host/join actions. The client becomes functional when
built against a deployed C.8 backend; no fake local fallback is used.

## Retained for compatibility / internal use (not public local UI)

These exist in code for old saves, tests, parity, online setup or internal
tooling and are intentionally not exposed in the local-match setup interface:

- `QuickBalanced` placement mode — used by authoritative invite matches and
  internal helpers, but not offered in public local setup.
- `transformEnabled: false` — supported when loading older saves; newly created
  public matches use Transform.
- `aiDifficulty` (`Easy/Medium/Hard`) — retained in the config model but hidden
  because the current AI does not meaningfully differentiate difficulty.
- Older/legacy save handling in `serialization` and
  `web/src/game/persistence/saveGame.ts`.
- The legacy **Pygbag** build in the separate `AssaltoRealeWeb` repository.

## Lifecycle & persistence

The local save/restore/undo/timer contract is documented in
[`match-lifecycle-contract.md`](match-lifecycle-contract.md) and covered by
characterisation tests. Online matches intentionally disable local undo,
save/load and JSON import/export: the authoritative server snapshot is the only
accepted online state.

## State architecture

`useGameStore` remains the public board/UI coordinator. Pure placement, turn,
clock, history and persistence logic lives under `web/src/game/`, while gameplay
authority lives in browser-independent `packages/game-core`.

For an online match, `onlineStore` owns connection/session state and projects
validated canonical snapshots into the existing board presentation. The
`onlineActionBridge` temporarily redirects board interactions to versioned
protocol commands and restores the original local actions when the user starts a
local match. The browser never commits an online move speculatively.

## Multiplayer architecture status

`packages/multiplayer-protocol` defines versioned command/event envelopes,
runtime validation, semantic command IDs, expected match versions, ordered event
streams and canonical reconnect snapshots.

Phase C.8 delivered the authoritative backend foundation:

- `packages/authoritative-server` validates principals, idempotency, membership
  and optimistic versions, invokes `game-core`, and emits canonical events;
- the PostgreSQL adapter persists canonical aggregates and exact command receipts
  atomically with compare-and-swap concurrency;
- `packages/server-transport` provides liveness/readiness HTTP endpoints,
  authenticated WebSocket upgrades, event routing, reconnect subscriptions,
  origin/payload/backpressure safeguards and graceful shutdown.

Phase C.9 adds invite-based untimed client integration:

- short-lived HMAC-signed anonymous guest sessions issued through `POST /session`;
- browser-compatible query-token WebSocket authentication with origin filtering;
- persistent session and match context within the browser session;
- host, join-by-code and waiting-room flows;
- exponential reconnect and canonical `RequestSync`;
- canonical snapshot projection into the existing board UI;
- server-authoritative placement, movement, Defended King, Transform, pass and
  resignation commands;
- pending-command, rejection, connection and side/turn ownership UX;
- focused unit, transport-integration and Playwright route coverage.

Anonymous guest sessions are not accounts. Cross-device continuity, production
account identity and long-lived profile ownership remain Phase C.10.

Phase C.9.5 adds the operational runtime that composes those packages into one
runnable server (`packages/server-runtime`): validated fail-fast configuration,
PostgreSQL pool + automatic migrations, liveness/readiness, structured logging,
graceful shutdown, a multi-stage Docker image and a local `docker compose` stack.
The composed stack is exercised end to end (HTTP guest session + two WebSocket
players + gameplay + reconnect) in CI, including a PostgreSQL-backed run. See
[`multiplayer-deployment.md`](multiplayer-deployment.md). It is **runnable and
container-buildable but not publicly deployed**.

## Known limitations (currently true)

- **The online backend is runnable but not publicly deployed.** The server can be
  started locally (`docker compose up --build`) and built as a container, but no
  external infrastructure is provisioned. The web interface fails closed until a
  deployment supplies the WebSocket/session endpoint and the web build sets
  `VITE_MULTIPLAYER_WS_URL`. See [`multiplayer-deployment.md`](multiplayer-deployment.md).
- **Online matches are invite-only and untimed.** There is no public matchmaking,
  rating, spectator mode, rematch implementation or server-authoritative clock.
- **Anonymous identity is browser-session scoped.** Clearing session storage or
  changing device loses the guest credential; account continuity is Phase C.10.
- **AI is a greedy heuristic** with no deep search and no meaningful difficulty
  differentiation yet.
- **Python ⇄ TypeScript parity is fixture-proven, not formally exhaustive.**
- Save migration is limited to the schema-1→2 path.
- Visual-regression baselines remain unseeded; the CI contract stays inert until
  Linux baselines are committed.
- Board keyboard navigation uses per-square tab stops rather than a roving
  arrow-key grid.
- No Android packaging, public matchmaking or ratings.

## Deployment status

The React/PWA client is deployed from this repository to GitHub Pages through
`.github/workflows/deploy-pages.yml`. `release-metadata.json` records the source
commit.

The authoritative-server, PostgreSQL and server-transport packages are validated
in CI but are not deployed. Running real online matches requires a composed
server process, PostgreSQL, secrets, TLS and a configured web build.

## Validation baseline

Required repository gates:

- Python rules-engine and workflow-config tests.
- Python–TypeScript deterministic parity fixtures and tests.
- Web unit coverage: **308 tests** with unchanged global thresholds.
- Web static quality: TypeScript, ESLint, Prettier and production audit.
- Web production build and package smokes.
- Playwright Chromium/mobile, Firefox/WebKit and visual-gate contract, including
  the visible online route and fail-closed unconfigured state.
- Authoritative server: strict TypeScript, architecture lint, Prettier, coverage,
  ESM smoke and production dependency audit.
- PostgreSQL 16 integration: migrations, canonical round-trip, invitation lookup,
  idempotent replay, concurrency, atomic rollback and corrupt-data guards.
- Server transport: strict TypeScript, architecture boundary, formatting, HTTP
  and real-WebSocket integration coverage, guest-session signing/bootstrap, ESM
  smoke and production audit.

## Roadmap position

```text
Phase A                               completed
Phase B.5 Store decomposition         completed
Phase B.6 Pure game-core              completed
Phase B.7 Multiplayer protocol        completed
Phase C.8 Authoritative server
  C.8.1 Application core              completed
  C.8.2 PostgreSQL adapter            completed
  C.8.3 Transport adapter             completed
Phase C.9 Invite multiplayer          completed by this phase
Phase C.10 Accounts/continuity        next
Phase C.11 Timed online matches       pending
Backend deployment                    required before public online play
Android packaging                     later
Matchmaking/ratings/social            later
```

Optional parallel work remains: stronger AI, broader generated parity, arrow-key
board navigation, mobile lifecycle hardening and deployment automation.
