// Operational multiplayer runtime (Phase C.9.5) — the composition root that turns
// the tested packages into a runnable full-stack authoritative server. It owns no
// game rules, protocol, authentication or persistence logic; it only composes:
//   @assalto-reale/authoritative-server  (commands, membership, idempotency, PG)
//   @assalto-reale/server-transport       (HTTP/WebSocket, guest sessions)
export {
  ConfigError,
  loadConfig,
  type Env,
  type RuntimeConfig,
  type RuntimeMode,
} from "./config.js";
export {
  composeServer,
  type ComposeOptions,
  type ComposedServer,
  type RuntimePersistence,
} from "./compose.js";
export { createRuntime, type Runtime, type RuntimeDeps } from "./runtime.js";
export {
  createJsonLogger,
  type LogLevel,
  type LoggerOptions,
  type RuntimeLogger,
} from "./logger.js";
export {
  CryptoIdGenerator,
  CryptoSeedGenerator,
  SystemClock,
} from "./ports.js";
