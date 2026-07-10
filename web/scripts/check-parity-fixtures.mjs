// Fails if the committed cross-engine parity fixtures are stale relative to the
// Python reference generator. Regenerates into a temp file and byte-compares —
// it never mutates the committed fixture, so CI verifies rather than rewrites.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const committed = join(here, "..", "tests", "fixtures", "python-engine-fixtures.json");
const generator = join(here, "generate_engine_fixtures.py");
const temp = join(tmpdir(), `assalto-parity-fixtures-${process.pid}.json`);
const python = process.env.PYTHON ?? "python";

execFileSync(python, [generator, temp], { stdio: "inherit" });

if (readFileSync(committed, "utf8") !== readFileSync(temp, "utf8")) {
  console.error(
    "Parity fixtures are stale.\n" + "Run `npm run parity:generate` and commit web/tests/fixtures/python-engine-fixtures.json.",
  );
  process.exit(1);
}
console.log("Parity fixtures are up to date.");
