# Release checklist

Run before publishing a new web release. Commands are run from the repo root
unless noted. The canonical status doc is `docs/current-product-status.md`;
deployment specifics are in `docs/deployment.md`.

## Pre-flight

- [ ] Working tree clean (`git status --short` empty), on an up-to-date `main`.
- [ ] Version incremented in `web/package.json` (canonical version). The UI
      version line and release metadata derive from it automatically.
- [ ] `CHANGELOG.md` updated for the new version.

## Quality gates (all must pass)

- [ ] Python tests — `python -m pip install -r requirements-dev.txt && python -m pytest -q`
- [ ] Typecheck — `cd web && npm ci && npm run typecheck`
- [ ] Lint — `npm run lint`
- [ ] Formatting — `npm run format:check`
- [ ] Unit tests + coverage thresholds — `npm run test:coverage`
- [ ] Production build — `npm run build`
- [ ] End-to-end (Chromium) — `npm run e2e`
- [ ] Production dependency audit — `npm run audit:prod` (must report 0)

## Packaging and base path

- [ ] Release package — `npm run package:release`, then confirm
      `release/assalto-reale-web-v1/` contains `index.html`, `404.html`,
      `manifest.webmanifest`, `sw.js`, `release-metadata.json`, `assets/`, `icons/`.
- [ ] `release-metadata.json` records the intended source commit and version.
- [ ] GitHub Pages base-path build —
      `npm run build -- --base /Assalto-Reale/` (on Windows/Git Bash prefix with
      `MSYS_NO_PATHCONV=1`); confirm `dist/index.html` references
      `/Assalto-Reale/assets/...` and that `manifest.webmanifest` + `sw.js` are present.

## PWA and persistence

- [ ] Manifest loads; icons resolve; theme/background colours are the light
      palette (no near-black frame).
- [ ] Service worker registers; only successful same-origin responses are cached;
      `release-metadata.json` is never cached; a new `CACHE_NAME` purges old caches.
- [ ] Save compatibility: existing local saves still load; JSON import/export
      round-trips. (localStorage is per-origin — moving origin/path gives a
      separate save store; there is no automatic migration.)

## Deploy and verify

- [ ] Deploy via `.github/workflows/deploy-pages.yml` (automatic after CI succeeds
      on `main`, or manual `workflow_dispatch`).
- [ ] The deploy workflow's `verify` job confirms the live site is reachable, the
      deployed `release-metadata.json` commit matches the tested commit, assets
      load, and no legacy Pygbag loader is served.
- [ ] Spot-check the live URL `https://andreatrdt.github.io/Assalto-Reale/`:
      routes load and refresh, board renders, a match can start.

## Rollback

- [ ] To roll back, re-run the deploy workflow (`workflow_dispatch`) against the
      last-known-good commit, or revert the offending merge on `main` and let CI +
      auto-deploy republish. The legacy Pygbag build remains preserved in the
      separate `AssaltoRealeWeb` repository if a full fallback is ever required.
