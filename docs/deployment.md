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

`npm run e2e` builds the app and serves the production preview through
Playwright (see `web/playwright.config.ts`), so end-to-end tests exercise the
built artifact rather than the dev server.

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

For a GitHub Pages **project site** (subpath), build with the matching base, e.g.
`https://andreatrdt.github.io/Assalto-Reale/`:

```bash
cd web
npm run build -- --base /Assalto-Reale/
```

The generated `404.html` preserves direct route attempts on static hosts that
support GitHub Pages-style 404 fallback: an unknown path returns `404.html`,
which stores the attempted path and redirects to the app, and
`web/src/app/routes.ts` restores the route. This preserves Back/Forward, direct
links, refresh, and `/game` route protection (a direct `/game` load with no
active match falls back to Setup, it does not start a new match).

**Windows/Git Bash caveat:** running `--base /Assalto-Reale/` from Git Bash
(MSYS2) mangles the leading-slash argument into a Windows path. Build with
`MSYS_NO_PATHCONV=1 npm run build -- --base /Assalto-Reale/`, or from PowerShell,
or let CI (Linux) do it — GitHub Actions is unaffected.

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

## Current public hosting

The legacy public site is hosted on **Vercel**, not GitHub Pages. The Vercel
project deploys the `public/` folder of `andreatrdt/AssaltoRealeWeb`, which
contains the old Pygbag build (`index.html` + `AssaltoReale.apk`, loaded from the
`pygame-web.github.io` CDN). `AssaltoRealeWeb/vercel.json` sets `outputDirectory:
"public"` and a SPA rewrite (`/(.*) -> /index.html`). There is no `CNAME` and no
GitHub Actions workflow in that repository.

## Deployment architecture

### Architecture A (prepared): GitHub Pages from the source repository

`.github/workflows/deploy-pages.yml` builds `web/` and publishes it to GitHub
Pages directly from `andreatrdt/Assalto-Reale`, using the official
`actions/configure-pages`, `actions/upload-pages-artifact` and
`actions/deploy-pages`. It is **manual (`workflow_dispatch`) only** and does not
touch the legacy Vercel site.

- Public URL: `https://andreatrdt.github.io/Assalto-Reale/` (base `/Assalto-Reale/`).
- Auth: the built-in `GITHUB_TOKEN` with `pages: write` + `id-token: write`. No
  external secret, no cross-repository access.
- One-time manual setting: **Settings -> Pages -> Source = "GitHub Actions"** in
  `andreatrdt/Assalto-Reale`.
- Safety: self-contained, reversible, and non-destructive — the current public
  (Vercel) site keeps serving until a switch is deliberately made.

Run it from the Actions tab; the deployed commit is recorded in
`release-metadata.json` and in the workflow run.

### Architecture B (alternative): preserve the current Vercel URL

To keep the exact current public URL, deploy the React build into
`andreatrdt/AssaltoRealeWeb` (which Vercel already serves):

1. Build `web/` with base `/` (Vercel serves at the domain root):
   `npm run build` (produces `web/dist`).
2. Replace `AssaltoRealeWeb/public/` with the contents of `web/dist` (the React
   `dist`, generated — no React source is copied). Add `release-metadata.json`.
3. `vercel.json`'s existing SPA rewrite (`/(.*) -> /index.html`) already handles
   client routing, so no `404.html` trick is required there. The Pygbag COOP/COEP
   headers are unused by the React app and may be left or removed.
4. Commit to `AssaltoRealeWeb` `main`; Vercel redeploys automatically.

Cross-repository automation (optional) would require a workflow in
`Assalto-Reale` that pushes `web/dist` to `AssaltoRealeWeb` using a **Personal
Access Token or deploy key with push access to `AssaltoRealeWeb`**, stored as an
Actions secret (e.g. `DEPLOY_REPO_TOKEN`). The token is never placed in source or
logs. This slice does not provision that secret or modify `AssaltoRealeWeb`.

## Preserving the legacy Pygbag build

The Pygbag build is preserved in `andreatrdt/AssaltoRealeWeb` git history (branch
`main`). Before switching the public site, create a durable marker in that
repository — a `legacy-pygbag` tag or branch, or a GitHub release containing
`public/index.html`, `public/AssaltoReale.apk`, `public/favicon.png` and
`vercel.json`. Do not delete the old build until the React deployment is verified
in production. Rollback = redeploy that preserved commit.

## Save Data

Web saves live in the player's browser `localStorage` under the current web origin. Moving between localhost, GitHub Pages and another domain gives each origin separate local saves.

## PWA Behavior

The production build registers a small service worker that caches the app shell and successfully fetched static assets. The game remains playable if service-worker registration fails or the browser does not support it.

Service-worker updates are intentionally conservative: a newly installed worker claims clients, but the app does not force a reload during an active match.

## Rollback

Republish the previous reviewed artifact. Use the source commit recorded in `release-metadata.json` to identify exactly what was deployed.
