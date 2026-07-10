# Assalto Reale — current product status

**This is the canonical source of truth for the current application.** Other
documents in `docs/` are design history or task-specific notes; where they
disagree with this file, this file wins. Last reconciled at the release-hardening
pass (see `CHANGELOG.md` for the version).

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
- Older/legacy save handling in `serialization` and the store's restore path.
- The legacy **Pygbag** build lives only in the separate `AssaltoRealeWeb`
  repository (historically hosted on Vercel); it is not part of this product.

## Lifecycle & persistence

The save/restore/undo/timer contract is documented in
[`match-lifecycle-contract.md`](match-lifecycle-contract.md) and covered by
characterisation tests (`web/src/game/state/persistence.test.ts`): a supported
match can be saved, closed, restored and continued across placement, mid-turn,
pending Defended-King, pending Transform, active territory claim, timed and
completed phases; imports are validated atomically; storage failures fail safe.

## Known limitations (currently true)

- **AI is a greedy heuristic** (`gameStore.ts` + `game/ai/evaluation.ts`): it
  scores immediate candidate actions and picks the best; there is no deep search,
  and difficulty levels are not yet meaningfully different.
- **Python ⇄ TypeScript parity is structural, not proven seed-identical.** The
  Python engine is the rules reference; parity fixtures exercise shared behaviour
  but exact seeded RNG/Special-Square parity has not been demonstrated.
- **Save migration** across schema changes is limited to the schema-1→2 path
  (handled inline in `restoreSavedGame`); there is no general migration framework.
- **Save confirmation during active play**: the "Game saved locally." message is
  surfaced only during placement, not in the active-play controls panel — the
  save itself persists correctly. Presentation-only; tracked for a later UX pass.
- **Visual-regression baselines are Linux-only** and seeded via the Playwright
  Docker image; the CI `web-visual` job stays inert until they are committed
  (see `docs/browser-quality.md`).
- **Board keyboard navigation** is per-square tab stops with Enter/Space
  activation; arrow-key roving grid navigation is not yet implemented.
- **`gameStore.ts` is large** and concentrates match/placement/AI/timer/save/undo
  coordination; decomposition is deferred.
- No online multiplayer, no Android packaging, no authentication/matchmaking.

## Deployment status

Live on **GitHub Pages** from this repository via
`.github/workflows/deploy-pages.yml` (manual `workflow_dispatch` and automatic
`workflow_run` after CI succeeds on `main`). `release-metadata.json` records the
deployed source commit. See `docs/deployment.md` and `docs/release-checklist.md`.

## Validation baseline

Recorded at the release-hardening pass (exact executed results are in the pull
request / final report; keep this list as the shape of the required gates):

- Python: `pytest` (rules-engine + workflow-config tests).
- Web unit: `vitest` with coverage thresholds.
- Static quality: `tsc` typecheck, ESLint, Prettier check.
- Production build: `tsc -b && vite build`.
- Playwright: Chromium full suite + Pixel-5 mobile (fast gate); Firefox/WebKit
  cross-browser smoke; axe accessibility gate; Chromium visual regression
  (Linux baselines, containerised CI job).
- Production dependency audit: `npm audit --omit=dev` (must be clean).

## Future milestones (not in scope here)

1. Broader Python/TypeScript lifecycle parity (seed-identical where feasible).
2. `gameStore.ts` decomposition.
3. A pure shared TypeScript `game-core` module.
4. A stronger AI (search/evaluation).
5. Online multiplayer.
6. Arrow-key board navigation and bfcache/mobile-suspension lifecycle coverage
   (deferred from browser-quality hardening; see `docs/browser-quality.md`).

Delivered since: persistence & match-lifecycle hardening; browser-quality
hardening (accessibility/axe, keyboard, cross-browser, visual regression,
reduced-motion/high-contrast, PWA/offline).
8. Android packaging.
