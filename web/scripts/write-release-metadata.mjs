// Writes web/dist/release-metadata.json so a deployed build is traceable to its
// exact tested source commit. Prefers SOURCE_COMMIT (the workflow_run head SHA)
// over GITHUB_SHA, falling back to git locally. The output contains no secrets,
// tokens, local filesystem paths, or developer-machine details.
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseMetadata } from "./releaseMetadata.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const distDir = path.join(webRoot, "dist");

if (!existsSync(distDir)) {
  throw new Error("Missing web/dist. Run `npm run build` before writing release metadata.");
}

const env = { ...process.env };
if (!env.SOURCE_COMMIT && !env.GITHUB_SHA) {
  try {
    env.SOURCE_COMMIT = execSync("git rev-parse HEAD", { cwd: webRoot, encoding: "utf8" }).trim();
  } catch {
    // leave unset; builder falls back to "unknown"
  }
}

const version = JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8")).version;
const metadata = buildReleaseMetadata(env, { version });

await writeFile(path.join(distDir, "release-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Wrote release-metadata.json (version ${metadata.version}, commit ${metadata.commit.slice(0, 7)}).`);
