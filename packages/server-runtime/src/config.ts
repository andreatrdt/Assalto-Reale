// Validated, fail-fast runtime configuration. Nothing here logs secrets, and
// production never silently accepts a weak default: missing or malformed inputs
// throw a ConfigError with an actionable message before any traffic is served.

export type RuntimeMode = "production" | "development";

export interface RuntimeConfig {
  mode: RuntimeMode;
  host: string;
  port: number;
  databaseUrl: string;
  allowedOrigins: readonly string[];
  websocketPath: string;
  /** Fixed by the transport + web client contract; surfaced for documentation. */
  readonly sessionPath: "/session";
  guestSessionSecret: string;
  guestSessionTtlMs: number;
  postGameReconnectGraceMs: number;
  authEnabled: boolean;
  authIssuerUrl: string | null;
  authAudience: string | null;
  authSessionIdClaim: string | null;
  authWebsocketTicketTtlMs: number;
  heartbeatIntervalMs: number;
  maxPayloadBytes: number;
  maxBufferedBytes: number;
  shutdownGraceMs: number;
  /** True when a clearly-labelled, development-only default secret was used. */
  usingDevelopmentSecret: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type Env = Record<string, string | undefined>;

const MIN_SECRET_BYTES = 32;
// Development-only, non-secret placeholder. Never valid in production.
const DEVELOPMENT_SECRET = "assalto-reale-development-guest-secret-000000";

function read(env: Env, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function requireValue(env: Env, key: string): string {
  const value = read(env, key);
  if (value === undefined) throw new ConfigError(`${key} is required.`);
  return value;
}

function parseMode(env: Env): RuntimeMode {
  const raw = read(env, "NODE_ENV") ?? "development";
  if (raw === "production" || raw === "development" || raw === "test") {
    return raw === "test" ? "development" : raw;
  }
  throw new ConfigError(
    `NODE_ENV must be "production", "development" or "test" (got "${raw}").`,
  );
}

function parseInteger(
  env: Env,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = read(env, key);
  if (raw === undefined) return fallback;
  if (!/^-?\d+$/.test(raw))
    throw new ConfigError(`${key} must be an integer (got "${raw}").`);
  const value = Number.parseInt(raw, 10);
  if (value < min || value > max)
    throw new ConfigError(
      `${key} must be between ${min} and ${max} (got ${value}).`,
    );
  return value;
}

function parseBoolean(env: Env, key: string, fallback: boolean): boolean {
  const raw = read(env, key);
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ConfigError(`${key} must be "true" or "false" (got "${raw}").`);
}

function parseAuthConfig(
  env: Env,
  mode: RuntimeMode,
): Pick<
  RuntimeConfig,
  | "authEnabled"
  | "authIssuerUrl"
  | "authAudience"
  | "authSessionIdClaim"
  | "authWebsocketTicketTtlMs"
> {
  const authEnabled = parseBoolean(env, "AUTH_ENABLED", false);
  const ticketTtlMs =
    parseInteger(env, "AUTH_WEBSOCKET_TICKET_TTL_SECONDS", 60, 15, 300) * 1_000;
  if (!authEnabled) {
    return {
      authEnabled,
      authIssuerUrl: null,
      authAudience: null,
      authSessionIdClaim: null,
      authWebsocketTicketTtlMs: ticketTtlMs,
    };
  }
  const rawIssuer = requireValue(env, "AUTH_ISSUER_URL");
  let issuer: URL;
  try {
    issuer = new URL(rawIssuer);
  } catch {
    throw new ConfigError("AUTH_ISSUER_URL must be a valid URL.");
  }
  if (
    issuer.search ||
    issuer.hash ||
    (issuer.protocol !== "https:" &&
      !(mode === "development" && issuer.protocol === "http:"))
  ) {
    throw new ConfigError(
      "AUTH_ISSUER_URL must be an HTTPS origin/path without query or fragment.",
    );
  }
  const audience = requireValue(env, "AUTH_AUDIENCE");
  const sessionIdClaim = requireValue(env, "AUTH_SESSION_ID_CLAIM");
  if (audience.length > 512 || sessionIdClaim.length > 256) {
    throw new ConfigError(
      "AUTH_AUDIENCE or AUTH_SESSION_ID_CLAIM is too long.",
    );
  }
  return {
    authEnabled,
    authIssuerUrl: issuer.toString(),
    authAudience: audience,
    authSessionIdClaim: sessionIdClaim,
    authWebsocketTicketTtlMs: ticketTtlMs,
  };
}

function parseDatabaseUrl(env: Env): string {
  const raw = requireValue(env, "DATABASE_URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("DATABASE_URL must be a valid URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new ConfigError(
      `DATABASE_URL must use the postgres:// scheme (got "${url.protocol}").`,
    );
  }
  return raw;
}

function parseOrigin(candidate: string): string {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ConfigError(`Allowed origin "${candidate}" is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(
      `Allowed origin "${candidate}" must use http or https.`,
    );
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new ConfigError(
      `Allowed origin "${candidate}" must not include a path, query or fragment.`,
    );
  }
  return url.origin;
}

function parseAllowedOrigins(env: Env, mode: RuntimeMode): readonly string[] {
  const raw = read(env, "MULTIPLAYER_ALLOWED_ORIGINS");
  if (raw === undefined) {
    if (mode === "production") {
      throw new ConfigError(
        "MULTIPLAYER_ALLOWED_ORIGINS is required in production (comma-separated origin allowlist).",
      );
    }
    // Development default: the local Vite dev server origins.
    return ["http://localhost:5173", "http://127.0.0.1:5173"];
  }
  const origins = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(parseOrigin);
  if (origins.length === 0) {
    throw new ConfigError(
      "MULTIPLAYER_ALLOWED_ORIGINS must list at least one origin.",
    );
  }
  return [...new Set(origins)];
}

function parseWebsocketPath(env: Env): string {
  const raw = read(env, "WEBSOCKET_PATH") ?? "/ws";
  if (!raw.startsWith("/") || /\s/.test(raw)) {
    throw new ConfigError(
      `WEBSOCKET_PATH must be an absolute path with no whitespace (got "${raw}").`,
    );
  }
  return raw;
}

function parseSessionPath(env: Env): "/session" {
  const raw = read(env, "SESSION_PATH");
  if (raw !== undefined && raw !== "/session") {
    throw new ConfigError(
      'SESSION_PATH is fixed at "/session" by the transport and web client; remove the override.',
    );
  }
  return "/session";
}

function parseGuestSecret(
  env: Env,
  mode: RuntimeMode,
): { secret: string; usingDevelopmentSecret: boolean } {
  const raw = read(env, "GUEST_SESSION_SECRET");
  if (raw === undefined) {
    if (mode === "production") {
      throw new ConfigError(
        `GUEST_SESSION_SECRET is required in production and must be at least ${MIN_SECRET_BYTES} bytes.`,
      );
    }
    return { secret: DEVELOPMENT_SECRET, usingDevelopmentSecret: true };
  }
  if (Buffer.byteLength(raw, "utf8") < MIN_SECRET_BYTES) {
    throw new ConfigError(
      `GUEST_SESSION_SECRET must contain at least ${MIN_SECRET_BYTES} bytes.`,
    );
  }
  if (mode === "production" && raw === DEVELOPMENT_SECRET) {
    throw new ConfigError(
      "GUEST_SESSION_SECRET must not be the development placeholder in production.",
    );
  }
  return { secret: raw, usingDevelopmentSecret: false };
}

export function loadConfig(env: Env = process.env): RuntimeConfig {
  const mode = parseMode(env);
  const { secret, usingDevelopmentSecret } = parseGuestSecret(env, mode);
  const auth = parseAuthConfig(env, mode);
  return {
    mode,
    host:
      read(env, "HOST") ?? (mode === "production" ? "0.0.0.0" : "127.0.0.1"),
    port: parseInteger(env, "PORT", 8080, 1, 65_535),
    databaseUrl: parseDatabaseUrl(env),
    allowedOrigins: parseAllowedOrigins(env, mode),
    websocketPath: parseWebsocketPath(env),
    sessionPath: parseSessionPath(env),
    guestSessionSecret: secret,
    guestSessionTtlMs:
      parseInteger(
        env,
        "GUEST_SESSION_TTL_SECONDS",
        12 * 60 * 60,
        60,
        7 * 24 * 60 * 60,
      ) * 1000,
    postGameReconnectGraceMs:
      parseInteger(env, "POST_GAME_RECONNECT_GRACE_SECONDS", 30, 1, 300) * 1000,
    ...auth,
    heartbeatIntervalMs: parseInteger(
      env,
      "HEARTBEAT_INTERVAL_MS",
      30_000,
      1_000,
      300_000,
    ),
    maxPayloadBytes: parseInteger(
      env,
      "MAX_PAYLOAD_BYTES",
      64 * 1024,
      1024,
      1024 * 1024,
    ),
    maxBufferedBytes: parseInteger(
      env,
      "MAX_BUFFERED_BYTES",
      1024 * 1024,
      64 * 1024,
      16 * 1024 * 1024,
    ),
    shutdownGraceMs: parseInteger(env, "SHUTDOWN_GRACE_MS", 10_000, 0, 120_000),
    usingDevelopmentSecret,
  };
}
