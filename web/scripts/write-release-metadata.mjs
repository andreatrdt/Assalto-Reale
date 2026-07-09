// Writes web/dist/release-metadata.json so a deployed build is traceable to its
// exact source commit. Values come from CI environment variables when available
// and fall back to git locally. The output intentionally contains no secrets,
// tokens, local filesystem paths, or developer-machine details.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const distDir = path.join(webRoot, "dist");

if (!existsSync(distDir)) {
  throw new Error("Missing web/dist. Run `npm run build` before writing release metadata.");
}

const repository = process.env.GITHUB_REPOSITORY || "andreatrdt/Assalto-Reale";

let commit = process.env.GITHUB_SHA || "";
if (!commit) {
  try {
    commit = execSync("git rev-parse HEAD", { cwd: webRoot, encoding: "utf8" }).trim();
  } catch {
    commit = "unknown";
  }
}

const builtAt = new Date().toISOString();
const version = commit && commit !== "unknown" ? commit.slice(0, 7) : "0.0.0";

const metadata = {
  repository,
  commit,
  builtAt,
  version,
  application: "Assalto Reale React web client",
};

await writeFile(path.join(distDir, "release-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Wrote release-metadata.json (commit ${version}).`);
