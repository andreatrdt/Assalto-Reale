import { defineConfig, devices } from "@playwright/test";

// Project strategy (deliberately narrow — we do NOT re-run the whole suite on a
// wide browser/viewport matrix):
//   chromium  — primary engine, runs the full functional + quality suite
//               (everything except the pixel-visual spec).
//   mobile    — Pixel 5, runs only the pre-existing specs that carry
//               viewport-specific assertions. New quality specs are NOT
//               multiplied onto it; specs that care about a viewport set it
//               themselves via test.use().
//   firefox / webkit — a small tagged cross-browser smoke suite only.
//   visual    — Chromium-only pixel regression, isolated so it never runs in
//               the fast local/CI gate. Baselines are Linux-only (see docs).
// Tablet, reduced-motion and forced-colors are applied per-spec with test.use,
// never as global projects.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  // CI-only retries absorb transient infrastructure timeouts (e.g. a cold
  // navigation under parallel-worker CPU contention). A genuine regression
  // still fails every attempt; local runs keep 0 retries so flakes stay visible.
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  // Serve the production build (preview) rather than the dev server so every
  // route is pre-compiled and the service worker/manifest behave as shipped.
  // The dev server compiles routes lazily on first hit, which under parallel
  // load could exceed the per-test timeout and flake.
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // Pixel-visual regression is isolated to its own project so it never runs
      // in the fast gate and only executes against committed Linux baselines.
      testIgnore: /visual\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
      // Keep mobile scoped to the specs that assert mobile layout/behaviour.
      // New quality specs stay single-project to avoid a wide matrix.
      testMatch: /(web-v1-smoke|board-motion|game-feel|lifecycle)\.spec\.ts/,
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testMatch: /cross-browser\.spec\.ts/,
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testMatch: /cross-browser\.spec\.ts/,
    },
    {
      name: "visual",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /visual\.spec\.ts/,
    },
  ],
});
