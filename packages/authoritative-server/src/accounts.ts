export type AccountUserStatus = "active" | "deleted";
export type PlayerIdentityKind = "guest" | "registered";

export interface AccountUser {
  userId: string;
  status: AccountUserStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface AuthIdentity {
  authIdentityId: string;
  userId: string;
  issuer: string;
  providerSubject: string;
  verifiedEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlayerIdentity {
  playerId: string;
  userId: string | null;
  kind: PlayerIdentityKind;
  createdAt: Date;
  claimedAt: Date | null;
  revokedAt: Date | null;
}

export interface AuthSession {
  sessionId: string;
  userId: string;
  authIdentityId: string;
  playerId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisteredIdentityClaims {
  issuer: string;
  providerSubject: string;
  providerSessionId: string;
  expiresAt: Date;
  verifiedEmail: string | null;
}

export interface RegisteredSession {
  user: AccountUser;
  identity: AuthIdentity;
  session: AuthSession;
  playerIdentity: PlayerIdentity;
}

export interface ActiveMatchMembership {
  matchId: string;
  playerId: string;
  side: "Black" | "White";
  status: "awaitingOpponent" | "active";
  updatedAt: Date;
}

export class AccountSessionRevokedError extends Error {
  constructor(message = "The registered session has been revoked.") {
    super(message);
    this.name = "AccountSessionRevokedError";
  }
}

export class AccountIdentityConflictError extends Error {
  constructor(
    message = "The player identity is already owned by another user.",
  ) {
    super(message);
    this.name = "AccountIdentityConflictError";
  }
}

export interface AccountRepository {
  ensureGuestIdentity(playerId: string): Promise<PlayerIdentity>;
  isGuestAuthenticationAllowed(playerId: string): Promise<boolean>;
  provisionRegisteredSession(
    claims: RegisteredIdentityClaims,
  ): Promise<RegisteredSession>;
  loadSession(sessionId: string, now?: Date): Promise<RegisteredSession | null>;
  revokeSession(sessionId: string, now?: Date): Promise<boolean>;
  claimGuestIdentity(
    sessionId: string,
    guestPlayerId: string,
    now?: Date,
  ): Promise<RegisteredSession>;
  listActiveMatches(userId: string): Promise<ActiveMatchMembership[]>;
  resolveMatchPlayer(userId: string, matchId: string): Promise<string | null>;
  saveWebsocketTicket(input: {
    ticketHash: string;
    sessionId: string;
    playerId: string;
    expiresAt: Date;
  }): Promise<void>;
  consumeWebsocketTicket(
    ticketHash: string,
    now?: Date,
  ): Promise<{ playerId: string; sessionId: string } | null>;
}
