import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (entry.endsWith(".ts")) files.push(full);
  }
  return files;
}

// The runtime composes only the application core and the transport. Game rules
// are reached through the application core, never imported directly.
const ALLOWED_BARE = new Set([
  "@assalto-reale/authoritative-server",
  "@assalto-reale/server-transport",
  "@assalto-reale/multiplayer-protocol",
]);
const FORBIDDEN_GLOBALS = ["window", "document", "localStorage", "navigator"];

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:from|import)\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

describe("runtime architecture boundaries", () => {
  const files = walk(srcDir);

  it("finds runtime source files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("imports only the application core, transport, protocol, pg (root only), Node or local modules", () => {
    for (const file of files) {
      const isCompositionRoot = file.endsWith("runtime.ts");
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        const ok =
          specifier.startsWith(".") ||
          specifier.startsWith("node:") ||
          ALLOWED_BARE.has(specifier) ||
          (specifier === "pg" && isCompositionRoot);
        expect(ok, `${file} imports disallowed module "${specifier}"`).toBe(
          true,
        );
      }
    }
  });

  it("never imports game-core directly (rules are encapsulated by the application core)", () => {
    for (const file of files) {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        expect(specifier.includes("game-core"), `${file} -> ${specifier}`).toBe(
          false,
        );
      }
    }
  });

  it("confines the PostgreSQL driver to the composition root", () => {
    for (const file of files) {
      if (importSpecifiers(readFileSync(file, "utf8")).includes("pg")) {
        expect(file.endsWith("runtime.ts"), file).toBe(true);
      }
    }
  });

  it("never imports React, Zustand, browser or web-app code", () => {
    for (const file of files) {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        expect(
          /^(react|react-dom|zustand)/.test(specifier),
          `${file} -> ${specifier}`,
        ).toBe(false);
        expect(specifier.includes("/web/"), `${file} -> ${specifier}`).toBe(
          false,
        );
      }
    }
  });

  it("never touches browser globals", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const global of FORBIDDEN_GLOBALS) {
        expect(
          new RegExp(`\\b${global}\\b`).test(source),
          `${file} references browser global "${global}"`,
        ).toBe(false);
      }
    }
  });
});
