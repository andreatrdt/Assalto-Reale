# Changelog

Notable changes to the Assalto Reale web client. The canonical application
version is `web/package.json`'s `version`; the UI version line and release
metadata derive from it.

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
