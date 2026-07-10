import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const postgresPath = `${sep}persistence${sep}postgres${sep}`;

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (entry.endsWith(".ts")) files.push(full);
  }
  return files;
}

const ALLOWED_BARE = new Set([
  "@assalto-reale/game-core",
  "@assalto-reale/multiplayer-protocol",
]);
const FORBIDDEN_GLOBALS = [
  "window",
  "document",
  "localStorage",
  "navigator",
  "performance",
];

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:from|import)\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

describe("architecture boundaries", () => {
  const files = walk(srcDir);

  it("finds server source files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("allows only declared package, Node, local and scoped PostgreSQL imports", () => {
    for (const file of files) {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        const ok =
          specifier.startsWith(".") ||
          specifier.startsWith("node:") ||
          ALLOWED_BARE.has(specifier) ||
          (specifier === "pg" && file.includes(postgresPath));
        expect(ok, `${file} imports disallowed module "${specifier}"`).toBe(
          true,
        );
      }
    }
  });

  it("confines the database driver to the PostgreSQL persistence adapter", () => {
    for (const file of files) {
      const importsPg = importSpecifiers(readFileSync(file, "utf8")).includes(
        "pg",
      );
      if (importsPg) expect(file.includes(postgresPath), file).toBe(true);
    }
  });

  it("never imports React, Zustand, browser or web-app code", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        expect(
          /^(react|react-dom|zustand)/.test(specifier),
          `${file} -> ${specifier}`,
        ).toBe(false);
        expect(specifier.includes("/web/"), `${file} -> ${specifier}`).toBe(
          false,
        );
        expect(specifier.includes("motion"), `${file} -> ${specifier}`).toBe(
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
