import { pathToFileURL } from "node:url";
import { ConfigError, loadConfig } from "./config.js";
import { createJsonLogger } from "./logger.js";
import { createRuntime } from "./runtime.js";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Process entrypoint. Validates configuration, starts the composed runtime,
 * installs signal-based graceful shutdown, and exits non-zero on fatal startup
 * failure. Never logs secrets.
 */
export async function main(): Promise<void> {
  const bootLogger = createJsonLogger({ level: "info" });

  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    const detail =
      error instanceof ConfigError ? error.message : messageOf(error);
    bootLogger.error("Invalid configuration; refusing to start.", {
      error: detail,
    });
    process.exitCode = 1;
    return;
  }

  const logger = createJsonLogger({
    level: config.mode === "production" ? "info" : "debug",
  });
  const runtime = createRuntime(config, { logger });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Received shutdown signal.", { signal });
    try {
      await runtime.stop();
      process.exit(0);
    } catch (error) {
      logger.error("Error during shutdown.", { error: messageOf(error) });
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await runtime.start();
  } catch (error) {
    logger.error("Fatal: the server failed to start.", {
      error: messageOf(error),
    });
    try {
      await runtime.stop();
    } catch {
      // Already failing; the process is exiting non-zero regardless.
    }
    process.exit(1);
  }
}

// Execute only when run directly (node dist/main.js), never when imported.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
