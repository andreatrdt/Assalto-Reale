# Assalto Reale Web v1 Release Audit

## Branch And Baseline

- Release branch: `release/web-v1`
- Source default branch: `main`
- Baseline commit: `e534fc64c2292011c501747f7e9488c837ed1798`
- Required visual follow-up commit present: `c31cbba`
- Audit started: 2026-07-08

## Baseline Validation

- `python -m pytest -q`: passed, 37 tests.
- `cd web && npm ci`: passed after rerunning outside the sandbox because the sandbox could not read the user npm cache. Baseline npm audit reports 5 vulnerabilities: 3 moderate, 1 high, 1 critical.
- `cd web && npm run test`: passed, 82 tests.
- `cd web && npm run build`: passed. Vite output: `index.html` 0.46 kB gzip 0.29 kB, CSS 21.25 kB gzip 5.41 kB, JS 394.47 kB gzip 123.12 kB.
- `cd web && npm run e2e`: failed at baseline with `Error: No tests found`.

## Confirmed Functional Gaps

- Playwright was configured but no e2e tests existed at baseline. Added initial route/setup/manual-placement/clock smoke coverage.
- Timers now count down during active human play and can produce timeout victory, but full Python policy parity for every pause/decision case is still incomplete.
- AI difficulty is captured by setup but live AI still uses the current deterministic greedy action path.
- Pending decisions do not yet use the release-scope discriminated `PendingDecision.owner` model.
- Save/load remains schema 1 and lacks runtime validation, import/export, migrations, and complete pending-decision restoration.
- Audio feedback is not wired.
- PWA/installability and offline behavior are missing.

## Confirmed Rule Mismatches

- Quick Balanced placement is still documented as heuristic and not fixture-proven against Python.
- TypeScript seeded setup uses deterministic logic but is not proven Python `random.Random` compatible.
- Transform generation and relocation are not fixture-proven against Python seeded behavior.
- Full-turn AI search is not ported from Python, so difficulty settings do not yet affect canonical search depth or budgets.

## Deployment Gaps

- README now distinguishes the modern React product from the legacy Pygbag build.
- `docs/deployment.md` now documents local development, production build, preview, base path, packaging, manual artifact workflow, GitHub Pages and rollback.
- CI and manual package workflows now exist.
- `npm run package:release` now builds and packages `web/dist` to `release/assalto-reale-web-v1/`.
- Web manifest, local icons, service worker and GitHub Pages-style `404.html` fallback now exist.
- Full deployment publication to `andreatrdt/AssaltoRealeWeb` remains an external owner action after release review.

## Implemented During Release Branch

- Added monotonic active-human clock ticking with timeout victory.
- Added deterministic Random side resolution from the persisted setup seed.
- Added initial Playwright e2e smoke coverage for all primary routes, Quick Balanced game start, manual placement save flow and live clock countdown on desktop and mobile projects.
- Added PWA metadata, manifest, local icons, service worker registration and static-host 404 fallback.
- Added base-path-aware routing for GitHub Pages-style subpath hosting.
- Added CI and manual web artifact packaging workflows.
- Added `docs/deployment.md`.
- Updated README deployment guidance for the modern React artifact.
- Added `npm run package:release`.

## Latest Validation On This Branch

- `npm run test`: passed, 85 tests.
- `npm run e2e`: passed, 8 tests.
- `npm run package:release`: passed and created `release/assalto-reale-web-v1/`.
- `npm run build -- --base /AssaltoRealeWeb/`: passed.
- Production preview smoke of built `dist/`: `/` returned 200 and `/setup` returned 200.

## Release Acceptance Criteria

The release is not complete until the gates in the v1 prompt are verified as passing or documented as requiring an external owner action.
