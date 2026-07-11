import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

function abs(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

// Consume the upstream packages through their built public entry points (dist),
// matching how the runtime typechecks against their published .d.ts. The
// `deps:build` step (run by the test scripts) builds them first.
const srcRoot = abs("./src").replaceAll("\\", "/");

export default defineConfig({
  resolve: {
    alias: {
      "@assalto-reale/authoritative-server": abs(
        "../authoritative-server/dist/index.js",
      ),
      "@assalto-reale/server-transport": abs(
        "../server-transport/dist/index.js",
      ),
      "@assalto-reale/multiplayer-protocol": abs(
        "../multiplayer-protocol/dist/index.js",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      include: [`${srcRoot}/**/*.ts`],
      // Excluded from unit coverage and exercised elsewhere: index.ts (barrel);
      // main.ts (process entrypoint — signal handlers/process.exit, exercised by
      // the smoke); runtime.ts (PostgreSQL composition root — exercised by the
      // TEST_DATABASE_URL-gated integration and the container smoke in CI).
      exclude: [
        `${srcRoot}/index.ts`,
        `${srcRoot}/main.ts`,
        `${srcRoot}/runtime.ts`,
      ],
      thresholds: {
        statements: 90,
        lines: 90,
        branches: 85,
        functions: 90,
      },
    },
  },
});
