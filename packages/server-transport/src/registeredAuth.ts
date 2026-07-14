import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { URL } from "node:url";
import {
  AccountIdentityConflictError,
  AccountSessionRevokedError,
  emptyPlayerStatistics,
  type AccountRepository,
  type AuthenticatedPrincipal,
  type MatchHistoryFilters,
  type MatchHistoryRepository,
  type RegisteredIdentityClaims,
  type RegisteredSession,
} from "@assalto-reale/authoritative-server";
import type {
  MatchHistoryDetails,
  MatchHistoryPage,
  PlayerStatisticsSummary,
} from "@assalto-reale/multiplayer-protocol";
import type { ConnectionAuthenticator } from "./connectionAuth.js";
import type { GuestSessionVerifier } from "./guestSessions.js";

export type VerifiedAccessToken = RegisteredIdentityClaims;

export interface RegisteredAccessTokenVerifier {
  verify(token: string): Promise<VerifiedAccessToken | null>;
}

export interface RegisteredSessionSummary {
  kind: "registered";
  user: {
    userId: string;
    status: "active";
    email: string | null;
  };
  playerId: string;
  sessionId: string;
  expiresAt: string;
}

export interface RegisteredWebsocketTicket extends AuthenticatedPrincipal {
  ticket: string;
  expiresAt: string;
}

export class RegisteredAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code:
      | "invalid_token"
      | "session_revoked"
      | "guest_proof_invalid"
      | "identity_conflict"
      | "match_not_owned"
      | "invalid_history_query"
      | "match_history_not_found",
    message: string,
  ) {
    super(message);
    this.name = "RegisteredAuthError";
  }
}

function ticketHash(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}

function summary(session: RegisteredSession): RegisteredSessionSummary {
  return {
    kind: "registered",
    user: {
      userId: session.user.userId,
      status: "active",
      email: session.identity.verifiedEmail,
    },
    playerId: session.playerIdentity.playerId,
    sessionId: session.session.sessionId,
    expiresAt: session.session.expiresAt.toISOString(),
  };
}

/**
 * Registered-account application service. Provider verification is injected;
 * account/player/session ownership is resolved only through persistence.
 */
export class RegisteredAuthService {
  constructor(
    private readonly verifier: RegisteredAccessTokenVerifier,
    private readonly accounts: AccountRepository,
    private readonly guestVerifier: GuestSessionVerifier,
    private readonly ticketTtlMs: number,
    private readonly now: () => Date = () => new Date(),
    private readonly randomTicket: () => string = () =>
      randomBytes(32).toString("base64url"),
    private readonly history?: MatchHistoryRepository,
  ) {}

  async establishSession(
    accessToken: string,
  ): Promise<RegisteredSessionSummary> {
    return summary(await this.authenticate(accessToken));
  }

  async logout(accessToken: string): Promise<void> {
    const session = await this.authenticate(accessToken);
    await this.accounts.revokeSession(session.session.sessionId, this.now());
  }

  async upgradeGuest(
    accessToken: string,
    guestToken: string,
  ): Promise<RegisteredSessionSummary> {
    const session = await this.authenticate(accessToken);
    const guest = await this.guestVerifier.verify(guestToken);
    if (!guest) {
      throw new RegisteredAuthError(
        401,
        "guest_proof_invalid",
        "The guest-session proof is invalid or expired.",
      );
    }
    try {
      return summary(
        await this.accounts.claimGuestIdentity(
          session.session.sessionId,
          guest.playerId,
          this.now(),
        ),
      );
    } catch (error) {
      if (error instanceof AccountIdentityConflictError) {
        throw new RegisteredAuthError(
          409,
          "identity_conflict",
          "This guest identity belongs to another account.",
        );
      }
      throw error;
    }
  }

  async listActiveMatches(accessToken: string): Promise<{
    matches: Array<{
      matchId: string;
      side: "Black" | "White";
      status: "awaitingOpponent" | "active";
      updatedAt: string;
    }>;
  }> {
    const session = await this.authenticate(accessToken);
    const matches = await this.accounts.listActiveMatches(session.user.userId);
    return {
      matches: matches.map((match) => ({
        matchId: match.matchId,
        side: match.side,
        status: match.status,
        updatedAt: match.updatedAt.toISOString(),
      })),
    };
  }

  async listMatchHistory(
    accessToken: string,
    filters: MatchHistoryFilters,
  ): Promise<MatchHistoryPage> {
    const session = await this.authenticate(accessToken);
    if (!this.history) return { matches: [], nextCursor: null };
    try {
      return await this.history.listForUser(session.user.userId, filters);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes("cursor")
      ) {
        throw new RegisteredAuthError(
          400,
          "invalid_history_query",
          error.message,
        );
      }
      throw error;
    }
  }

  async getMatchHistory(
    accessToken: string,
    matchId: string,
  ): Promise<MatchHistoryDetails> {
    const session = await this.authenticate(accessToken);
    const match = this.history
      ? await this.history.getForUser(session.user.userId, matchId)
      : null;
    if (!match) {
      throw new RegisteredAuthError(
        404,
        "match_history_not_found",
        "The completed match was not found for this account.",
      );
    }
    return match;
  }

  async getPlayerStatistics(
    accessToken: string,
  ): Promise<PlayerStatisticsSummary> {
    const session = await this.authenticate(accessToken);
    return this.history
      ? this.history.statisticsForUser(session.user.userId)
      : emptyPlayerStatistics();
  }

  async issueWebsocketTicket(
    accessToken: string,
    matchId: string | null,
  ): Promise<RegisteredWebsocketTicket> {
    const session = await this.authenticate(accessToken);
    let playerId = session.playerIdentity.playerId;
    if (matchId) {
      const resolved = await this.accounts.resolveMatchPlayer(
        session.user.userId,
        matchId,
      );
      if (!resolved) {
        throw new RegisteredAuthError(
          403,
          "match_not_owned",
          "The account is not a member of this match.",
        );
      }
      playerId = resolved;
    }
    const ticket = this.randomTicket();
    const expiresAt = new Date(this.now().getTime() + this.ticketTtlMs);
    await this.accounts.saveWebsocketTicket({
      ticketHash: ticketHash(ticket),
      sessionId: session.session.sessionId,
      playerId,
      expiresAt,
    });
    return {
      ticket,
      playerId,
      sessionId: session.session.sessionId,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async consumeWebsocketTicket(
    ticket: string,
  ): Promise<AuthenticatedPrincipal | null> {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(ticket)) return null;
    const consumed = await this.accounts.consumeWebsocketTicket(
      ticketHash(ticket),
      this.now(),
    );
    return consumed ? { ...consumed, authKind: "registered" } : null;
  }

  private async authenticate(accessToken: string): Promise<RegisteredSession> {
    const claims = await this.verifier.verify(accessToken);
    if (!claims || claims.expiresAt <= this.now()) {
      throw new RegisteredAuthError(
        401,
        "invalid_token",
        "The registered access token is invalid or expired.",
      );
    }
    try {
      return await this.accounts.provisionRegisteredSession(claims);
    } catch (error) {
      if (error instanceof AccountSessionRevokedError) {
        throw new RegisteredAuthError(
          401,
          "session_revoked",
          "The registered session has ended. Sign in again.",
        );
      }
      throw error;
    }
  }
}

export class RegisteredTicketConnectionAuthenticator implements ConnectionAuthenticator {
  constructor(private readonly auth: RegisteredAuthService) {}

  async authenticate(
    request: IncomingMessage,
  ): Promise<AuthenticatedPrincipal | null> {
    let ticket: string | null = null;
    try {
      ticket = new URL(
        request.url ?? "/",
        "http://transport.local",
      ).searchParams.get("ticket");
    } catch {
      return null;
    }
    return ticket ? this.auth.consumeWebsocketTicket(ticket) : null;
  }
}

export class GuestOrRegisteredConnectionAuthenticator implements ConnectionAuthenticator {
  constructor(
    private readonly guest: ConnectionAuthenticator,
    private readonly registered: ConnectionAuthenticator,
  ) {}

  async authenticate(
    request: IncomingMessage,
  ): Promise<AuthenticatedPrincipal | null> {
    let registered = false;
    try {
      registered = new URL(
        request.url ?? "/",
        "http://transport.local",
      ).searchParams.has("ticket");
    } catch {
      return null;
    }
    return registered
      ? this.registered.authenticate(request)
      : this.guest.authenticate(request);
  }
}
