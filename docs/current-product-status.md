# Assalto Reale — current product status

**This is the canonical source of truth for the current application.** Other
documents in `docs/` are design history or task-specific notes; where they
disagree with this file, this file wins. Last reconciled through the full-rules
parity, game-store decomposition, pure game-core, multiplayer-protocol,
authoritative application-core and PostgreSQL persistence passes (see
`CHANGELOG.md`).

## What ships publicly

The public product is the modern **React + TypeScript + Vite** client under
`web/`, deployed to GitHub Pages at
`https://andreatrdt.github.io/Assalto-Reale/` (project-site base path
`/Assalto-Reale/`). All of the following are exposed and working in the
user-facing app (verified from implementation and tests):

- 12×12 board, Black versus White, one King + Attack/Defense/Conquest pawns each.
- **Human vs Human** and **Human vs Computer** (single computer side).
- **Manual placement** (snake schedule) — the only public placement mode.
- **Transform enabled** for every new public match (no public on/off toggle).
- **Timed and untimed** matches (Untimed, 5/10/12/15/20 minutes).
- **Defended King** sacrifice-and-bounce, with an on-board preview and a
  contextual decision panel.
- **Victory**: king-capture, territory majority, and timeout — with an
  accessible victory overlay.
- **Undo**, **local save/load**, and **JSON import/export** of a match.
- **Board-motion animations** (move, capture, placement, Defended-King, Transform)
  and a synthesized **audio** layer with mute + volume.
- **Reduced-motion** and **high-contrast board** accessibility settings.
- Responsive **board-first** desktop and mobile layouts.
- Installable **PWA** (manifest, icons, service worker, `404.html` SPA fallback)
  and a packaged production build.

Online multiplayer is not exposed in the client yet.

## Retained for compatibility / internal use (not public UI)

These exist in code for old saves, tests, parity or internal tooling and are
**intentionally not exposed** in the public interface — do not treat their
presence as a public feature:

- `QuickBalanced` placement mode — retained in `matchConfig` and the store's
  `startQuickMatch` helper (used by tests/internal), removed from public setup.
- `transformEnabled: false` — supported when loading older saves; public matches
  always create with Transform on.
- `aiDifficulty` (`Easy/Medium/Hard`) — retained in the config model, **hidden**
  from public setup because the AI does not yet differentiate by difficulty.
- Older/legacy save handling in `serialization` and
  `web/src/game/persistence/saveGame.ts`.
- The legacy **Pygbag** build lives only in the separate `AssaltoRealeWeb`
  repository (historically hosted on Vercel); it is not part of this product.

## Lifecycle & persistence

The save/restore/undo/timer contract is documented in
[`match-lifecycle-contract.md`](match-lifecycle-contract.md) and covered by
characterisation tests (`web/src/game/state/persistence.test.ts`): a supported
match can be saved, closed, restored and continued across placement, mid-turn,
pending Defended-King, pending Transform, active territory claim, timed and
completed phases; imports are validated atomically; storage failures fail safe.

## State architecture

`useGameStore` remains the only public Zustand entry point. The store acts as a
browser/UI coordinator while pure placement, turn, clock, history and persistence
logic lives in focused modules under `web/src/game/`. Its public runtime surface
is frozen by `storeContract.test.ts`.

Gameplay authority lives in the browser-independent `packages/game-core`. The
web app and authoritative server consume the same public package through their
respective adapters. See [`game-store-contract.md`](game-store-contract.md) and
[`game-core-extraction.md`](game-core-extraction.md).

## Multiplayer architecture status

The transport-independent wire contract is implemented by
`packages/multiplayer-protocol`. It defines versioned command/event envelopes,
runtime validation, semantic command IDs, expected match versions, ordered event
streams and canonical reconnect snapshots. It does not implement networking.

Phase C.8.1 added `packages/authoritative-server`, an application/domain core that:

- authenticates an injected transport principal and matches it to the declared actor;
- enforces semantic command idempotency, membership and optimistic match versions;
- generates match IDs, invite codes and deterministic setup seeds server-side;
- invokes `game-core` as the only gameplay-rules authority;
- atomically commits match state and command receipts;
- returns ordered `multiplayer-protocol` event envelopes;
- supports invite-code join, resignation and canonical `RequestSync`;
- exposes repository/unit-of-work ports plus a deterministic in-memory adapter.

Phase C.8.2 implements those ports with PostgreSQL:

- versioned and checksum-verified migrations protected by an advisory lock;
- canonical `game-core` state and exact command results stored as validated JSONB;
- unique invitation codes and command IDs;
- atomic receipt + aggregate transactions;
- compare-and-swap match-version updates;
- integration tests against PostgreSQL 16 for concurrency, rollback and replay.

The server still deliberately has no HTTP/WebSocket transport, production
authentication provider, account system or multiplayer UI. See
[`authoritative-server.md`](authoritative-server.md).

## Known limitations (currently true)

- **AI is a greedy heuristic** (`game/state/gameStore.ts` +
  `game/ai/evaluation.ts`): it scores immediate candidate actions and picks the
  best; there is no deep search, and difficulty levels are not yet meaningfully
  different.
- **Python ⇄ TypeScript parity is fixture-proven, not formally exhaustive.** The
  shared PRNG, seeded generation, complete turns and special mechanics are
  covered by deterministic cross-runtime fixtures, but this is not a formal
  proof over every reachable game state.
- **Save migration** across schema changes is limited to the schema-1→2 path in
  `game/persistence/saveGame.ts`; there is no general migration framework.
- **Save confirmation during active play**: the "Game saved locally." message is
  surfaced only during placement, not in the active-play controls panel — the
  save itself persists correctly. Presentation-only; tracked for a later UX pass.
- **Visual-regression baselines are Linux-only** and seeded via the Playwright
  Docker image; the CI `web-visual` job stays inert until they are committed
  (see `docs/browser-quality.md`).
- **Board keyboard navigation** is per-square tab stops with Enter/Space
  activation; arrow-key roving grid navigation is not yet implemented.
- The server foundation is not a deployable online product until transport,
  production authentication/accounts and client integration are added.
- No Android packaging, public matchmaking or ratings.

## Deployment status

Live on **GitHub Pages** from this repository via
`.github/workflows/deploy-pages.yml` (manual `workflow_dispatch` and automatic
`workflow_run` after CI succeeds on `main`). `release-metadata.json` records the
deployed source commit. See `docs/deployment.md` and `docs/release-checklist.md`.

The authoritative-server package and PostgreSQL adapter are validated in CI but
are not deployed.

## Validation baseline

Required repository gates:

- Python: `pytest` (rules-engine + workflow-config tests).
- Python–TypeScript deterministic parity fixtures and tests.
- Web unit: `vitest` with coverage thresholds.
- Web static quality: TypeScript, ESLint, Prettier and production audit.
- Web production build and package smokes.
- Playwright Chromium/mobile, Firefox/WebKit and visual-gate contract.
- Authoritative server: strict TypeScript, architecture lint, Prettier, coverage
  thresholds, ESM build, plain-Node smoke and production dependency audit.
- PostgreSQL 16 integration: migrations, canonical round-trip, invitation lookup,
  idempotent replay, concurrency, atomic rollback and corrupt-data guards.

## Roadmap position

```text
Phase A                               completed
Phase B.5 Store decomposition         completed
Phase B.6 Pure game-core              completed
Phase B.7 Multiplayer protocol        completed
Phase C.8 Authoritative server
  C.8.1 Application core              completed
  C.8.2 PostgreSQL adapter            completed by this phase
  C.8.3 Transport adapter             next
Phase C.9 Invite multiplayer          pending
Phase C.10 Accounts/continuity        pending
Phase C.11 Timed online matches       pending
Android packaging                     later
Matchmaking/ratings/social            later
```

Optional parallel work remains: stronger AI, broader generated parity, arrow-key
board navigation and mobile lifecycle hardening.
