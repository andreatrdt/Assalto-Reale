import { defineConfig } from "vitest/config";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")).version;

function shortCommit(): string {
  const fromEnv = process.env.SOURCE_COMMIT || process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(shortCommit()),
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/main.tsx", "src/app/App.tsx"],
      // Honest thresholds set just below the current measured baseline
      // (statements/lines 76.5%, branches 74.1%, functions 69.9%). Planned
      // increase towards 80/80/80/75 is tracked in docs/current-product-status.md.
      thresholds: {
        statements: 75,
        lines: 75,
        branches: 72,
        functions: 68,
      },
    },
  },
});
