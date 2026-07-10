import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

function abs(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

const srcRoot = abs("./src").replaceAll("\\", "/");

export default defineConfig({
  resolve: {
    alias: {
      "@assalto-reale/authoritative-server": abs(
        "../authoritative-server/dist/index.js",
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
