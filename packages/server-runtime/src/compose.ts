import {
  CommandHandler,
  type Clock,
  type IdGenerator,
  type MatchRepository,
  type SeedGenerator,
  type UnitOfWork,
} from "@assalto-reale/authoritative-server";
import {
  ContextualAuthenticator,
  GuestSessionConnectionAuthenticator,
  HmacGuestSessionService,
  bindCommandHandler,
  createAuthoritativeTransportServer,
  type AuthoritativeTransportServer,
  type ReadinessProbe,
  type TransportLogger,
} from "@assalto-reale/server-transport";
import type { RuntimeConfig } from "./config.js";
import {
  CryptoIdGenerator,
  CryptoSeedGenerator,
  SystemClock,
} from "./ports.js";

export interface RuntimePersistence {
  matches: MatchRepository;
  unitOfWork: UnitOfWork;
}

export interface ComposeOptions {
  config: RuntimeConfig;
  persistence: RuntimePersistence;
  readiness?: ReadinessProbe;
  logger?: TransportLogger;
  clock?: Clock;
  ids?: IdGenerator;
  seeds?: SeedGenerator;
  // Deterministic hooks for tests only.
  guestSessionNow?: () => number;
  guestSessionRandomId?: () => string;
}

export interface ComposedServer {
  server: AuthoritativeTransportServer;
  guestSessions: HmacGuestSessionService;
}

/**
 * Wire the application core, guest-session service and transport into a runnable
 * server. This is the single composition point: it introduces no game rules,
 * protocol handling, authentication logic or persistence of its own.
 */
export function composeServer(options: ComposeOptions): ComposedServer {
  const { config, persistence } = options;

  const contextual = new ContextualAuthenticator();
  const handler = new CommandHandler({
    matches: persistence.matches,
    unitOfWork: persistence.unitOfWork,
    authenticator: contextual,
    clock: options.clock ?? new SystemClock(),
    ids: options.ids ?? new CryptoIdGenerator(),
    seeds: options.seeds ?? new CryptoSeedGenerator(),
  });
  const executor = bindCommandHandler(handler, contextual);

  const guestSessions = new HmacGuestSessionService(config.guestSessionSecret, {
    ttlMs: config.guestSessionTtlMs,
    ...(options.guestSessionNow ? { now: options.guestSessionNow } : {}),
    ...(options.guestSessionRandomId
      ? { randomId: options.guestSessionRandomId }
      : {}),
  });
  const authenticateConnection = new GuestSessionConnectionAuthenticator(
    guestSessions,
  );

  const server = createAuthoritativeTransportServer({
    executor,
    authenticateConnection,
    guestSessions,
    ...(options.readiness ? { readiness: options.readiness } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    websocketPath: config.websocketPath,
    allowedOrigins: config.allowedOrigins,
    maxPayloadBytes: config.maxPayloadBytes,
    maxBufferedBytes: config.maxBufferedBytes,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    shutdownGraceMs: config.shutdownGraceMs,
  });

  return { server, guestSessions };
}
