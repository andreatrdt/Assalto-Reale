# Assalto Reale Web Deployment

## Product Sources

- Canonical rules reference: `assalto_pygbag_ready/assalto_core.py` and `assalto_pygbag_ready/assalto_app_ai.py`
- Modern web product: `web/`
- Legacy browser build: Pygbag output from `assalto_pygbag_ready/`

The v1 web deployment artifact is the production output of `web/`. Do not deploy a fresh Pygbag build as the modern web product.

## Local Development

```bash
cd web
npm ci
npm run dev
```

Open the Vite URL, normally `http://127.0.0.1:5173/`.

## Validation

Run the release gates before packaging:

```bash
python -m pytest -q
cd web
npm ci
npm run test
npm run build
npm run e2e
```

`npm run e2e` starts the Vite dev server through Playwright.

## Production Build

```bash
cd web
npm run build
```

The static output is written to `web/dist/`.

## Production Preview

```bash
cd web
npm run build
npm run preview -- --host 127.0.0.1
```

Use the preview server to test the built files, not only the dev server.

## Base Path

Vite's `BASE_URL` is respected by navigation, service-worker registration, manifest links and icon links.

For a domain root, the default base path `/` is correct.

For a GitHub Pages repository subpath such as `https://andreatrdt.github.io/AssaltoRealeWeb/`, build with:

```bash
cd web
npm run build -- --base /AssaltoRealeWeb/
```

The generated `404.html` preserves direct route attempts on static hosts that support GitHub Pages-style 404 fallback.

## Package A Reviewable Artifact

```bash
cd web
npm run package:release
```

This runs a production build, copies `web/dist/` to `release/assalto-reale-web-v1/`, and writes `release-metadata.json` containing the source commit and build timestamp.

The `release/` directory is ignored by git. Upload or publish its contents as the static site artifact.

## Manual GitHub Artifact Workflow

Use the `Package Web Artifact` workflow from GitHub Actions.

1. Open Actions.
2. Choose `Package Web Artifact`.
3. Run it with a reviewed source ref, for example `release/web-v1`.
4. Download the `assalto-reale-web` artifact.
5. Publish the artifact contents to the selected static host after review.

This workflow does not push to `andreatrdt/AssaltoRealeWeb` automatically. That keeps the existing deployment repository safe until branch protections and hosting behavior are confirmed.

## GitHub Pages Setup

If deploying to `andreatrdt/AssaltoRealeWeb`:

1. Confirm the Pages source branch and folder in that repository.
2. Build this repository with the base path `/AssaltoRealeWeb/`.
3. Copy the artifact contents into the Pages source folder.
4. Commit with the source commit from `release-metadata.json`.
5. Verify `/`, `/setup`, `/game`, `/rules`, `/load` and `/settings` after publication.

## Save Data

Web saves live in the player's browser `localStorage` under the current web origin. Moving between localhost, GitHub Pages and another domain gives each origin separate local saves.

## PWA Behavior

The production build registers a small service worker that caches the app shell and successfully fetched static assets. The game remains playable if service-worker registration fails or the browser does not support it.

Service-worker updates are intentionally conservative: a newly installed worker claims clients, but the app does not force a reload during an active match.

## Rollback

Republish the previous reviewed artifact. Use the source commit recorded in `release-metadata.json` to identify exactly what was deployed.
