# Changelog

Notable changes to the Assalto Reale web client. The canonical application
version is `web/package.json`'s `version`; the UI version line and release
metadata derive from it.

## Unreleased

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

- Added a blocking axe-core accessibility gate (`web/tests/e2e/a11y.spec.ts`)
  over every primary route and an active match; fails on `serious`/`critical`
  violations. Fixes to clear the baseline: board `role="grid"` now wraps each
  rank in a `role="row"`; the `/rules` capture table gained `role="cell"`; the
  `/load` file input gained an `aria-label`.
- Accessibility contrast: darkened the neutral text ramp (`--text-muted`,
  `--text-faint`) to WCAG AA (>=4.5:1) on all surfaces, and replaced the inactive
  player-clock `opacity` de-emphasis (which failed contrast) with a colour/border
  treatment.
- Added forced-colors (Windows High Contrast) support as a blocking contract and
  `prefers-contrast: more` support (additive CSS); `Escape` now closes
  dismissible modals while the Transform/Defended-King panels stay non-bypassable.
- New e2e suites: keyboard/focus, motion-contrast, responsive
  (desktop/tablet/mobile), PWA/offline, save import/export via the real UI, AI
  paced-loop teardown, a Firefox+WebKit cross-browser smoke, and a Chromium-only
  visual-regression spec (Linux baselines via Docker).
- Playwright now runs Chromium (full suite) + Pixel-5 mobile in the fast gate,
  with dedicated CI jobs for the Firefox/WebKit smoke and the containerised
  visual regression. Default `npm run e2e` grew 32 -> 63 tests.
- Removed the unused `web/src/game/ai/aiWorker.ts` (dead code; the AI runs
  synchronously in the store). Added `@axe-core/playwright` (devDependency;
  production audit stays at 0 vulnerabilities).
- Web unit tests unchanged at 186; coverage 77.3% statements / 76.7% branches.

Lifecycle & persistence hardening — characterisation tests plus two small,
tested bug fixes. No gameplay rules, AI, timer semantics or UI design changed.

- Added [`docs/match-lifecycle-contract.md`](docs/match-lifecycle-contract.md)
  and a persistence characterisation suite
  (`web/src/game/state/persistence.test.ts`, 33 tests): save→restore→continue
  across placement, mid-turn, pending Defended-King, pending Transform, active
  territory claim, timed and completed matches; undo across phases; deterministic
  timer round-trips; atomic import validation with malformed-import rejection;
  storage-failure handling; AI-owned decision restoration.
- Fix: `saveGame` now handles a storage write throwing (e.g. quota) without
  corrupting the in-memory match (returns a message), matching `importSaveJson`.
- Fix: restoring a completed (`gameOver`) match preserves the saved victory
  message so the victory presentation shows the correct winner/reason.
- Strengthened `validateSavedGame` to reject malformed imports atomically
  (bad/unknown schema, invalid phase, unknown piece type, out-of-bounds squares,
  out-of-range action points/placement cursor, negative clocks, malformed pending
  owner) before any restore; the active match is preserved on rejection.
- Web unit tests 153 → 186; coverage improved (branches 74.1% → 76.6%).
- Known limitation: during active play the "Game saved locally." confirmation is
  not surfaced in the controls panel (the save still persists; it is shown during
  placement). Tracked for a later UX pass.

## 1.0.0-beta.1

First versioned prerelease of the modern React/TypeScript web client. It
consolidates the recently merged feature work and adds release-quality gates. It
is a **beta**: the product is publicly playable but not yet declared a stable
1.0. See `docs/current-product-status.md` for the authoritative feature list and
limitations.

### Product (already shipped, now versioned)

- 12×12 Black-vs-White tactical game; Human-vs-Human and Human-vs-Computer.
- Manual placement; Transform always enabled for public matches; timed/untimed.
- Defended King (on-board preview + decision), territory / king-capture / timeout
  victory.
- Undo, local save/load, JSON import/export.
- Board-motion animations, synthesized audio with mute/volume, victory overlay.
- Reduced-motion and high-contrast accessibility; responsive board-first layout.
- Installable PWA; GitHub Pages deployment with post-deploy verification.

### Release hardening (this version)

- Canonical version set to `1.0.0-beta.1`; unified package/deploy release-metadata
  schema (now always includes `version`).
- Removed unused `howler` / `@types/howler` dependencies.
- Added quality scripts: `typecheck`, `lint` (ESLint flat config),
  `format:check` (Prettier), `test:coverage` (honest thresholds), `audit:prod`.
- Strengthened CI with static-quality, coverage-gated unit, and
  production-dependency-audit jobs.
- Added `docs/current-product-status.md` (canonical) and
  `docs/release-checklist.md`; reconciled historical design docs.
- Removed a few dead imports/vars surfaced by lint (behaviour-preserving; all
  tests unchanged).

### Known limitations

Greedy heuristic AI; Python/TS parity structural (not proven seed-identical);
Chromium-only browser coverage in CI; no visual-regression/a11y automation;
`gameStore.ts` still large. Full list in `docs/current-product-status.md`.
