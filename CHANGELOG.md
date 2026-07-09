# Changelog

Notable changes to the Assalto Reale web client. The canonical application
version is `web/package.json`'s `version`; the UI version line and release
metadata derive from it.

## Unreleased

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
