import { defineConfig, devices } from "@playwright/test";

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
  // route is pre-compiled. The dev server compiles routes lazily on first hit,
  // which under parallel load could exceed the per-test timeout and flake.
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
});
