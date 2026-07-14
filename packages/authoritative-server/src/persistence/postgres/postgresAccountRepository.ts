import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  AccountIdentityConflictError,
  AccountSessionRevokedError,
  type AccountRepository,
  type AccountUser,
  type ActiveMatchMembership,
  type AuthIdentity,
  type AuthSession,
  type PlayerIdentity,
  type RegisteredIdentityClaims,
  type RegisteredSession,
} from "../../accounts.js";
import { rebuildPostgresPlayerStatistics } from "./postgresHistoryRepository.js";

interface AccountRow extends QueryResultRow {
  user_id: string;
  user_status: "active" | "deleted";
  user_created_at: Date;
  user_updated_at: Date;
  deleted_at: Date | null;
  auth_identity_id: string;
  issuer: string;
  provider_subject: string;
  verified_email: string | null;
  identity_created_at: Date;
  identity_updated_at: Date;
  session_id: string;
  player_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  session_created_at: Date;
  session_updated_at: Date;
  player_user_id: string | null;
  player_kind: "guest" | "registered";
  player_created_at: Date;
  claimed_at: Date | null;
  player_revoked_at: Date | null;
}

interface PlayerRow extends QueryResultRow {
  player_id: string;
  user_id: string | null;
  kind: "guest" | "registered";
  created_at: Date;
  claimed_at: Date | null;
  revoked_at: Date | null;
}

interface IdentityRow extends QueryResultRow {
  auth_identity_id: string;
  user_id: string;
}

const SESSION_SELECT = `
  SELECT
    u.user_id,
    u.status AS user_status,
    u.created_at AS user_created_at,
    u.updated_at AS user_updated_at,
    u.deleted_at,
    i.auth_identity_id,
    i.issuer,
    i.provider_subject,
    i.verified_email,
    i.created_at AS identity_created_at,
    i.updated_at AS identity_updated_at,
    s.session_id,
    s.player_id,
    s.expires_at,
    s.revoked_at,
    s.created_at AS session_created_at,
    s.updated_at AS session_updated_at,
    p.user_id AS player_user_id,
    p.kind AS player_kind,
    p.created_at AS player_created_at,
    p.claimed_at,
    p.revoked_at AS player_revoked_at
  FROM account_auth_sessions s
  JOIN account_users u ON u.user_id = s.user_id
  JOIN account_auth_identities i ON i.auth_identity_id = s.auth_identity_id
  JOIN player_identities p ON p.player_id = s.player_id
`;

class ConcurrentProvisionError extends Error {}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function providerSessionHash(claims: RegisteredIdentityClaims): string {
  return createHash("sha256")
    .update(claims.issuer)
    .update("\0")
    .update(claims.providerSessionId)
    .digest("hex");
}

function playerFromRow(row: PlayerRow): PlayerIdentity {
  return {
    playerId: row.player_id,
    userId: row.user_id,
    kind: row.kind,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    revokedAt: row.revoked_at,
  };
}

function sessionFromRow(row: AccountRow): RegisteredSession {
  const user: AccountUser = {
    userId: row.user_id,
    status: row.user_status,
    createdAt: row.user_created_at,
    updatedAt: row.user_updated_at,
    deletedAt: row.deleted_at,
  };
  const identity: AuthIdentity = {
    authIdentityId: row.auth_identity_id,
    userId: row.user_id,
    issuer: row.issuer,
    providerSubject: row.provider_subject,
    verifiedEmail: row.verified_email,
    createdAt: row.identity_created_at,
    updatedAt: row.identity_updated_at,
  };
  const session: AuthSession = {
    sessionId: row.session_id,
    userId: row.user_id,
    authIdentityId: row.auth_identity_id,
    playerId: row.player_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.session_created_at,
    updatedAt: row.session_updated_at,
  };
  const playerIdentity: PlayerIdentity = {
    playerId: row.player_id,
    userId: row.player_user_id,
    kind: row.player_kind,
    createdAt: row.player_created_at,
    claimedAt: row.claimed_at,
    revokedAt: row.player_revoked_at,
  };
  return { user, identity, session, playerIdentity };
}

async function selectSession(
  queryable: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  clause: string,
  value: string,
): Promise<RegisteredSession | null> {
  const result = await queryable.query<AccountRow>(
    `${SESSION_SELECT} WHERE ${clause} = $1`,
    [value],
  );
  return result.rows[0] ? sessionFromRow(result.rows[0]) : null;
}

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly pool: Pool) {}

  async ensureGuestIdentity(playerId: string): Promise<PlayerIdentity> {
    const result = await this.pool.query<PlayerRow>(
      `
        INSERT INTO player_identities (player_id, kind)
        VALUES ($1, 'guest')
        ON CONFLICT (player_id) DO UPDATE SET player_id = EXCLUDED.player_id
        RETURNING player_id, user_id, kind, created_at, claimed_at, revoked_at
      `,
      [playerId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Guest player identity was not persisted.");
    return playerFromRow(row);
  }

  async isGuestAuthenticationAllowed(playerId: string): Promise<boolean> {
    const result = await this.pool.query<{
      user_id: string | null;
      revoked_at: Date | null;
    }>(
      "SELECT user_id, revoked_at FROM player_identities WHERE player_id = $1",
      [playerId],
    );
    const row = result.rows[0];
    // A stateless legacy credential issued before migration 3 may not have a row
    // until its first match write. Missing is safe to treat as an unclaimed guest.
    return !row || (row.user_id === null && row.revoked_at === null);
  }

  async provisionRegisteredSession(
    claims: RegisteredIdentityClaims,
  ): Promise<RegisteredSession> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.provisionOnce(claims);
      } catch (error) {
        if (!(error instanceof ConcurrentProvisionError) || attempt === 1) {
          throw error;
        }
      }
    }
    throw new Error("Registered account provisioning did not converge.");
  }

  private async provisionOnce(
    claims: RegisteredIdentityClaims,
  ): Promise<RegisteredSession> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      let identity = await client.query<IdentityRow>(
        `
          SELECT auth_identity_id, user_id
          FROM account_auth_identities
          WHERE issuer = $1 AND provider_subject = $2
          FOR UPDATE
        `,
        [claims.issuer, claims.providerSubject],
      );

      if (!identity.rows[0]) {
        const userId = id("user");
        const authIdentityId = id("identity");
        const playerId = id("player");
        await client.query("INSERT INTO account_users (user_id) VALUES ($1)", [
          userId,
        ]);
        await client.query(
          `
            INSERT INTO player_identities (player_id, user_id, kind, claimed_at)
            VALUES ($1, $2, 'registered', NOW())
          `,
          [playerId, userId],
        );
        const inserted = await client.query<IdentityRow>(
          `
            INSERT INTO account_auth_identities (
              auth_identity_id, user_id, issuer, provider_subject, verified_email
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (issuer, provider_subject) DO NOTHING
            RETURNING auth_identity_id, user_id
          `,
          [
            authIdentityId,
            userId,
            claims.issuer,
            claims.providerSubject,
            claims.verifiedEmail,
          ],
        );
        if (!inserted.rows[0]) throw new ConcurrentProvisionError();
        identity = inserted;
      }

      const identityRow = identity.rows[0]!;
      const user = await client.query<{ status: "active" | "deleted" }>(
        "SELECT status FROM account_users WHERE user_id = $1 FOR UPDATE",
        [identityRow.user_id],
      );
      if (user.rows[0]?.status !== "active") {
        throw new AccountSessionRevokedError("The account is not active.");
      }
      if (claims.verifiedEmail) {
        await client.query(
          `
            UPDATE account_auth_identities
            SET verified_email = $2, updated_at = NOW()
            WHERE auth_identity_id = $1
          `,
          [identityRow.auth_identity_id, claims.verifiedEmail],
        );
      }

      const hash = providerSessionHash(claims);
      const existing = await selectSession(
        client,
        "s.provider_session_hash",
        hash,
      );
      if (existing?.session.revokedAt) throw new AccountSessionRevokedError();
      if (existing) {
        await client.query(
          `
            UPDATE account_auth_sessions
            SET expires_at = GREATEST(expires_at, $2), updated_at = NOW()
            WHERE session_id = $1
          `,
          [existing.session.sessionId, claims.expiresAt],
        );
        await client.query("COMMIT");
        return (await selectSession(
          this.pool,
          "s.session_id",
          existing.session.sessionId,
        ))!;
      }

      const player = await client.query<{ player_id: string }>(
        `
          SELECT player_id
          FROM player_identities
          WHERE user_id = $1 AND kind = 'registered' AND revoked_at IS NULL
          ORDER BY created_at, player_id
          LIMIT 1
        `,
        [identityRow.user_id],
      );
      const playerId = player.rows[0]?.player_id;
      if (!playerId) throw new Error("Registered player identity is missing.");
      const sessionId = id("session");
      await client.query(
        `
          INSERT INTO account_auth_sessions (
            session_id, user_id, auth_identity_id, player_id,
            provider_session_hash, expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          sessionId,
          identityRow.user_id,
          identityRow.auth_identity_id,
          playerId,
          hash,
          claims.expiresAt,
        ],
      );
      await client.query("COMMIT");
      const created = await selectSession(this.pool, "s.session_id", sessionId);
      if (!created) throw new Error("Registered session was not persisted.");
      return created;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async loadSession(
    sessionId: string,
    now = new Date(),
  ): Promise<RegisteredSession | null> {
    const session = await selectSession(this.pool, "s.session_id", sessionId);
    if (
      !session ||
      session.user.status !== "active" ||
      session.session.revokedAt ||
      session.session.expiresAt <= now ||
      session.playerIdentity.revokedAt
    ) {
      return null;
    }
    return session;
  }

  async revokeSession(sessionId: string, now = new Date()): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE account_auth_sessions
        SET revoked_at = COALESCE(revoked_at, $2), updated_at = NOW()
        WHERE session_id = $1 AND revoked_at IS NULL
      `,
      [sessionId, now],
    );
    return result.rowCount === 1;
  }

  async claimGuestIdentity(
    sessionId: string,
    guestPlayerId: string,
    now = new Date(),
  ): Promise<RegisteredSession> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const session = await selectSession(client, "s.session_id", sessionId);
      if (
        !session ||
        session.session.revokedAt ||
        session.session.expiresAt <= now ||
        session.user.status !== "active"
      ) {
        throw new AccountSessionRevokedError(
          "The registered session is not active.",
        );
      }
      await client.query(
        `
          INSERT INTO player_identities (player_id, kind)
          VALUES ($1, 'guest')
          ON CONFLICT (player_id) DO NOTHING
        `,
        [guestPlayerId],
      );
      const opposingMembership = await client.query(
        `
          SELECT 1
          FROM match_memberships target
          JOIN match_memberships owned
            ON owned.match_id = target.match_id
           AND owned.player_id <> target.player_id
          JOIN player_identities owned_player
            ON owned_player.player_id = owned.player_id
          WHERE target.player_id = $1
            AND owned_player.user_id = $2
          LIMIT 1
        `,
        [guestPlayerId, session.user.userId],
      );
      if (opposingMembership.rowCount) {
        throw new AccountIdentityConflictError(
          "An account cannot own both sides of the same match.",
        );
      }
      const claimed = await client.query<PlayerRow>(
        `
          UPDATE player_identities
          SET user_id = $2, claimed_at = COALESCE(claimed_at, $3)
          WHERE player_id = $1 AND (user_id IS NULL OR user_id = $2)
          RETURNING player_id, user_id, kind, created_at, claimed_at, revoked_at
        `,
        [guestPlayerId, session.user.userId, now],
      );
      if (!claimed.rows[0]) throw new AccountIdentityConflictError();
      await client.query(
        `
          UPDATE account_auth_sessions
          SET player_id = $2, updated_at = NOW()
          WHERE session_id = $1
        `,
        [sessionId, guestPlayerId],
      );
      await rebuildPostgresPlayerStatistics(client, session.user.userId);
      await client.query("COMMIT");
      const updated = await selectSession(this.pool, "s.session_id", sessionId);
      if (!updated)
        throw new Error("Claimed registered session was not found.");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listActiveMatches(userId: string): Promise<ActiveMatchMembership[]> {
    const result = await this.pool.query<{
      match_id: string;
      player_id: string;
      side: "Black" | "White";
      status: "awaitingOpponent" | "active";
      updated_at: Date;
    }>(
      `
        SELECT m.match_id, mm.player_id, mm.side, m.status, m.updated_at
        FROM match_memberships mm
        JOIN player_identities p ON p.player_id = mm.player_id
        JOIN authoritative_matches m ON m.match_id = mm.match_id
        WHERE p.user_id = $1
          AND p.revoked_at IS NULL
          AND m.status IN ('awaitingOpponent', 'active')
        ORDER BY m.updated_at DESC, m.match_id
      `,
      [userId],
    );
    return result.rows.map((row) => ({
      matchId: row.match_id,
      playerId: row.player_id,
      side: row.side,
      status: row.status,
      updatedAt: row.updated_at,
    }));
  }

  async resolveMatchPlayer(
    userId: string,
    matchId: string,
  ): Promise<string | null> {
    const result = await this.pool.query<{ player_id: string }>(
      `
        SELECT mm.player_id
        FROM match_memberships mm
        JOIN player_identities p ON p.player_id = mm.player_id
        WHERE mm.match_id = $1 AND p.user_id = $2 AND p.revoked_at IS NULL
        ORDER BY mm.side
        LIMIT 1
      `,
      [matchId, userId],
    );
    return result.rows[0]?.player_id ?? null;
  }

  async saveWebsocketTicket(input: {
    ticketHash: string;
    sessionId: string;
    playerId: string;
    expiresAt: Date;
  }): Promise<void> {
    const inserted = await this.pool.query(
      `
        INSERT INTO registered_websocket_tickets (
          ticket_hash, session_id, player_id, expires_at
        )
        SELECT $1, s.session_id, p.player_id, $4
        FROM account_auth_sessions s
        JOIN player_identities p
          ON p.player_id = $3 AND p.user_id = s.user_id
        WHERE s.session_id = $2
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
          AND p.revoked_at IS NULL
      `,
      [input.ticketHash, input.sessionId, input.playerId, input.expiresAt],
    );
    if (inserted.rowCount !== 1) {
      throw new AccountSessionRevokedError(
        "The session cannot issue a WebSocket ticket for this player identity.",
      );
    }
  }

  async consumeWebsocketTicket(
    ticketHash: string,
    now = new Date(),
  ): Promise<{ playerId: string; sessionId: string } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const consumed = await client.query<{
        player_id: string;
        session_id: string;
      }>(
        `
          UPDATE registered_websocket_tickets t
          SET consumed_at = $2
          FROM account_auth_sessions s, player_identities p
          WHERE t.ticket_hash = $1
            AND t.consumed_at IS NULL
            AND t.expires_at > $2
            AND s.session_id = t.session_id
            AND s.revoked_at IS NULL
            AND s.expires_at > $2
            AND p.player_id = t.player_id
            AND p.user_id = s.user_id
            AND p.revoked_at IS NULL
          RETURNING t.player_id, t.session_id
        `,
        [ticketHash, now],
      );
      await client.query("COMMIT");
      return consumed.rows[0]
        ? {
            playerId: consumed.rows[0].player_id,
            sessionId: consumed.rows[0].session_id,
          }
        : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
