import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

function abs(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

// Consume game-core and multiplayer-protocol through their built public entry
// points (dist), matching the way the server typechecks against their published
// .d.ts. Build the packages before running the suite (the web `server:test`
// script does this).
const srcRoot = abs("./src").replaceAll("\\", "/");

export default defineConfig({
  resolve: {
    alias: {
      "@assalto-reale/game-core": abs("../game-core/dist/index.js"),
      "@assalto-reale/multiplayer-protocol": abs("../multiplayer-protocol/dist/index.js"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      include: [`${srcRoot}/**/*.ts`],
      exclude: [`${srcRoot}/index.ts`],
      thresholds: {
        statements: 90,
        lines: 90,
        branches: 85,
        functions: 90,
      },
    },
  },
});
