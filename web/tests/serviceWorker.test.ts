import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sw = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8");

describe("service worker update/caching assumptions", () => {
  it("uses a versioned cache name and purges older caches while claiming clients", () => {
    expect(sw).toContain("assalto-reale-web-v2");
    expect(sw).toContain("caches.delete");
    expect(sw).toContain("clients.claim");
    expect(sw).toContain("skipWaiting");
  });

  it("uses scope-relative app-shell paths so it works under a base subpath", () => {
    expect(sw).toContain('"./"');
    expect(sw).toContain('"./manifest.webmanifest"');
    // No absolute root paths in the precached shell (would break under /Assalto-Reale/).
    expect(sw).not.toMatch(/APP_SHELL\s*=\s*\[[^\]]*"\/[A-Za-z]/);
  });

  it("never caches error responses or release metadata", () => {
    expect(sw).toContain("response.ok");
    expect(sw).toContain("release-metadata");
  });
});
