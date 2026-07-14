import {
  CommandHandler,
  type AccountRepository,
  type Clock,
  type IdGenerator,
  type MatchRepository,
  type SeedGenerator,
  type UnitOfWork,
} from "@assalto-reale/authoritative-server";
import {
  ContextualAuthenticator,
  GuestOrRegisteredConnectionAuthenticator,
  GuestSessionConnectionAuthenticator,
  HmacGuestSessionService,
  OidcAccessTokenVerifier,
  RegisteredAuthService,
  RegisteredTicketConnectionAuthenticator,
  bindCommandHandler,
  createAuthoritativeTransportServer,
  type AuthoritativeTransportServer,
  type ConnectionAuthenticator,
  type ReadinessProbe,
  type TransportLogger,
  type RegisteredAccessTokenVerifier,
} from "@assalto-reale/server-transport";
import type { RuntimeConfig } from "./config.js";
import { CryptoIdGenerator, CryptoSeedGenerator, SystemClock } from "./ports.js";

export interface RuntimePersistence {
  matches: MatchRepository;
  unitOfWork: UnitOfWork;
  accounts?: AccountRepository;
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
  registeredAccessTokenVerifier?: RegisteredAccessTokenVerifier;
  registeredTicketNow?: () => Date;
  registeredTicketRandom?: () => string;
}

export interface ComposedServer {
  server: AuthoritativeTransportServer;
  guestSessions: HmacGuestSessionService;
  registeredAuth: RegisteredAuthService | null;
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
    postGameReconnectGraceMs: config.postGameReconnectGraceMs,
  });
  const executor = bindCommandHandler(handler, contextual);

  const guestSessions = new HmacGuestSessionService(config.guestSessionSecret, {
    ttlMs: config.guestSessionTtlMs,
    ...(options.guestSessionNow ? { now: options.guestSessionNow } : {}),
    ...(options.guestSessionRandomId ? { randomId: options.guestSessionRandomId } : {}),
    ...(persistence.accounts
      ? {
          registerIdentity: async (playerId: string) => {
            await persistence.accounts!.ensureGuestIdentity(playerId);
          },
          validateIdentity: (playerId: string) => persistence.accounts!.isGuestAuthenticationAllowed(playerId),
        }
      : {}),
  });
  const guestAuthenticator = new GuestSessionConnectionAuthenticator(guestSessions);
  let registeredAuth: RegisteredAuthService | null = null;
  let authenticateConnection: ConnectionAuthenticator = guestAuthenticator;
  if (config.authEnabled) {
    if (!persistence.accounts || !config.authIssuerUrl || !config.authAudience || !config.authSessionIdClaim) {
      throw new Error("Registered authentication dependencies are incomplete.");
    }
    const verifier =
      options.registeredAccessTokenVerifier ??
      new OidcAccessTokenVerifier({
        issuer: config.authIssuerUrl,
        audience: config.authAudience,
        sessionIdClaim: config.authSessionIdClaim,
      });
    registeredAuth = new RegisteredAuthService(
      verifier,
      persistence.accounts,
      guestSessions,
      config.authWebsocketTicketTtlMs,
      options.registeredTicketNow,
      options.registeredTicketRandom,
    );
    authenticateConnection = new GuestOrRegisteredConnectionAuthenticator(
      guestAuthenticator,
      new RegisteredTicketConnectionAuthenticator(registeredAuth),
    );
  }

  const server = createAuthoritativeTransportServer({
    executor,
    authenticateConnection,
    guestSessions,
    ...(registeredAuth ? { registeredAuth } : {}),
    ...(options.readiness ? { readiness: options.readiness } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    websocketPath: config.websocketPath,
    allowedOrigins: config.allowedOrigins,
    maxPayloadBytes: config.maxPayloadBytes,
    maxBufferedBytes: config.maxBufferedBytes,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    shutdownGraceMs: config.shutdownGraceMs,
  });

  return { server, guestSessions, registeredAuth };
}
