import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (entry.endsWith(".ts")) files.push(path);
  }
  return files;
}

function imports(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:from|import)\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) found.push(match[1]!);
  return found;
}

const ALLOWED_BARE = new Set([
  "@assalto-reale/authoritative-server",
  "@assalto-reale/multiplayer-protocol",
  "ws",
]);

describe("transport architecture boundary", () => {
  const files = walk(srcDir);

  it("contains transport source files", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it("imports only the application core, protocol, ws, node or local modules", () => {
    for (const file of files) {
      for (const specifier of imports(readFileSync(file, "utf8"))) {
        const allowed =
          specifier.startsWith(".") ||
          specifier.startsWith("node:") ||
          ALLOWED_BARE.has(specifier);
        expect(allowed, `${file} imports ${specifier}`).toBe(true);
      }
    }
  });

  it("never imports game rules, persistence clients, UI or browser modules", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of imports(source)) {
        expect(specifier.includes("game-core"), `${file} -> ${specifier}`).toBe(
          false,
        );
        expect(specifier === "pg", `${file} -> ${specifier}`).toBe(false);
        expect(
          /^(react|react-dom|zustand|socket\.io)/.test(specifier),
          `${file} -> ${specifier}`,
        ).toBe(false);
        expect(specifier.includes("/web/"), `${file} -> ${specifier}`).toBe(
          false,
        );
      }
    }
  });
});
