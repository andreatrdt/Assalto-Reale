import { Pool } from "pg";
import {
  createPostgresPersistence,
  runPostgresMigrations,
} from "@assalto-reale/authoritative-server";
import type {
  ReadinessProbe,
  TransportAddress,
} from "@assalto-reale/server-transport";
import type { RuntimeConfig } from "./config.js";
import { composeServer, type ComposedServer } from "./compose.js";
import { createJsonLogger, type RuntimeLogger } from "./logger.js";

export interface Runtime {
  start(): Promise<TransportAddress>;
  stop(): Promise<void>;
}

export interface RuntimeDeps {
  logger?: RuntimeLogger;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The production composition root. Owns the PostgreSQL pool and its lifecycle;
 * runs migrations before serving; exposes a readiness probe that turns the
 * process unready when the database is unreachable; and shuts down transport and
 * database resources safely (idempotently) on request.
 */
export function createRuntime(
  config: RuntimeConfig,
  deps: RuntimeDeps = {},
): Runtime {
  const logger =
    deps.logger ??
    createJsonLogger({
      level: config.mode === "production" ? "info" : "debug",
    });
  const pool = new Pool({ connectionString: config.databaseUrl });
  pool.on("error", (error) =>
    logger.error("PostgreSQL pool error.", { error: messageOf(error) }),
  );

  const persistence = createPostgresPersistence(pool);
  const readiness: ReadinessProbe = {
    async check(): Promise<boolean> {
      try {
        await pool.query("SELECT 1");
        return true;
      } catch (error) {
        logger.error("Readiness check failed: database unreachable.", {
          error: messageOf(error),
        });
        return false;
      }
    },
  };

  let composed: ComposedServer | null = null;
  let stopping: Promise<void> | null = null;

  async function start(): Promise<TransportAddress> {
    logger.info("Starting multiplayer server.", {
      mode: config.mode,
      host: config.host,
      port: config.port,
    });
    if (config.usingDevelopmentSecret) {
      logger.warn(
        "Using the development-only guest-session secret. This must never run in production.",
      );
    }
    // Fail fast if the database is unreachable, then apply migrations.
    await pool.query("SELECT 1");
    await runPostgresMigrations(pool);
    composed = composeServer({ config, persistence, readiness, logger });
    const address = await composed.server.listen({
      host: config.host,
      port: config.port,
    });
    logger.info("Multiplayer server ready.", {
      host: address.host,
      port: address.port,
      websocketPath: address.websocketPath,
      sessionPath: config.sessionPath,
      allowedOrigins: config.allowedOrigins,
    });
    return address;
  }

  async function stop(): Promise<void> {
    if (stopping) return stopping;
    stopping = (async () => {
      logger.info("Stopping multiplayer server.");
      try {
        if (composed) await composed.server.close();
      } finally {
        await pool
          .end()
          .catch((error) =>
            logger.error("Error closing PostgreSQL pool.", {
              error: messageOf(error),
            }),
          );
      }
      logger.info("Multiplayer server stopped.");
    })();
    return stopping;
  }

  return { start, stop };
}
