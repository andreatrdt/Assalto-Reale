import type { ClientCommandEnvelope } from "@assalto-reale/multiplayer-protocol";

// Injectable side-effect boundaries. The application core never reaches for a
// real clock, RNG, id source, or transport principal directly; each is provided
// so tests can supply deterministic implementations.

/** The transport principal, resolved from an authenticated connection. */
export interface AuthenticatedPrincipal {
  playerId: string;
  sessionId: string;
}

/**
 * Resolves the authenticated principal for an inbound command envelope. The
 * transport owns real authentication; the application core only trusts what this
 * returns and separately verifies it against the envelope's declared actor.
 */
export interface Authenticator {
  authenticate(
    envelope: ClientCommandEnvelope,
  ): Promise<AuthenticatedPrincipal | null>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  matchId(): string;
  eventId(): string;
  inviteCode(): string;
}

/** Server-side deterministic seed source. Client-provided seeds are never used. */
export interface SeedGenerator {
  next(): number;
}
