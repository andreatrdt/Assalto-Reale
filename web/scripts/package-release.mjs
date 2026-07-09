import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseMetadata } from "./releaseMetadata.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webRoot, "..");
const distDir = path.join(webRoot, "dist");
const releaseRoot = path.join(repoRoot, "release");
const artifactDir = path.join(releaseRoot, "assalto-reale-web-v1");

if (!existsSync(distDir)) {
  throw new Error("Missing web/dist. Run npm run build before packaging.");
}

const env = { ...process.env };
if (!env.SOURCE_COMMIT && !env.GITHUB_SHA) {
  env.SOURCE_COMMIT = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
}
const version = JSON.parse(await readFile(path.join(webRoot, "package.json"), "utf8")).version;
// Same schema as the deployed metadata (scripts/write-release-metadata.mjs).
const metadata = buildReleaseMetadata(env, { version });

await mkdir(releaseRoot, { recursive: true });
await rm(artifactDir, { recursive: true, force: true });
await cp(distDir, artifactDir, { recursive: true });
await writeFile(path.join(artifactDir, "release-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);

console.log(`Packaged ${artifactDir} (version ${metadata.version}, commit ${metadata.commit.slice(0, 7)})`);
