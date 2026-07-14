import { createHash } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";

export interface PostgresMigration {
  version: number;
  name: string;
  sql: string;
}

interface AppliedMigrationRow extends QueryResultRow {
  version: number;
  name: string;
  checksum: string;
}

const MIGRATION_LOCK_KEY = 1_928_374_651;

export const POSTGRES_MIGRATIONS: readonly PostgresMigration[] = [
  {
    version: 1,
    name: "create_authoritative_match_tables",
    sql: `
CREATE TABLE authoritative_matches (
  match_id TEXT PRIMARY KEY,
  invite_code TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL CHECK (version > 0),
  stream_sequence INTEGER NOT NULL CHECK (stream_sequence >= 0),
  seed BIGINT NOT NULL,
  config JSONB NOT NULL,
  black_player_id TEXT,
  white_player_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('awaitingOpponent', 'active', 'ended')),
  state JSONB NOT NULL,
  end_reason TEXT CHECK (
    end_reason IS NULL OR end_reason IN (
      'king_capture',
      'territory',
      'timeout',
      'resignation',
      'abandonment'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE authoritative_command_receipts (
  command_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  match_id TEXT,
  payload_hash TEXT NOT NULL,
  envelopes JSONB NOT NULL CHECK (jsonb_typeof(envelopes) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX authoritative_command_receipts_match_id_idx
  ON authoritative_command_receipts (match_id);
`,
  },
  {
    version: 2,
    name: "add_rematch_lineage_columns",
    sql: `
ALTER TABLE authoritative_matches
  ADD COLUMN rematch_offered_by TEXT,
  ADD COLUMN successor_match_id TEXT,
  ADD COLUMN predecessor_match_id TEXT;

CREATE UNIQUE INDEX authoritative_matches_successor_match_id_key
  ON authoritative_matches (successor_match_id)
  WHERE successor_match_id IS NOT NULL;
`,
  },
  {
    version: 3,
    name: "add_account_identity_foundation",
    sql: `
CREATE TABLE account_users (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE account_auth_identities (
  auth_identity_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES account_users(user_id) ON DELETE RESTRICT,
  issuer TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  verified_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (issuer, provider_subject)
);

CREATE INDEX account_auth_identities_user_id_idx
  ON account_auth_identities (user_id);

CREATE TABLE player_identities (
  player_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES account_users(user_id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('guest', 'registered')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CHECK (kind = 'guest' OR user_id IS NOT NULL)
);

CREATE INDEX player_identities_user_id_idx
  ON player_identities (user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE account_auth_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES account_users(user_id) ON DELETE CASCADE,
  auth_identity_id TEXT NOT NULL REFERENCES account_auth_identities(auth_identity_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES player_identities(player_id) ON DELETE RESTRICT,
  provider_session_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX account_auth_sessions_user_id_idx
  ON account_auth_sessions (user_id);

CREATE INDEX account_auth_sessions_active_expiry_idx
  ON account_auth_sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE registered_websocket_tickets (
  ticket_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES account_auth_sessions(session_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES player_identities(player_id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX registered_websocket_tickets_expiry_idx
  ON registered_websocket_tickets (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE match_memberships (
  match_id TEXT NOT NULL REFERENCES authoritative_matches(match_id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('Black', 'White')),
  player_id TEXT NOT NULL REFERENCES player_identities(player_id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role = 'player'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_id, side),
  UNIQUE (match_id, player_id)
);

CREATE INDEX match_memberships_player_id_idx
  ON match_memberships (player_id);

INSERT INTO player_identities (player_id, kind)
SELECT DISTINCT player_id, 'guest'
FROM (
  SELECT black_player_id AS player_id FROM authoritative_matches
  UNION ALL
  SELECT white_player_id AS player_id FROM authoritative_matches
) legacy_players
WHERE player_id IS NOT NULL
ON CONFLICT (player_id) DO NOTHING;

INSERT INTO match_memberships (match_id, side, player_id)
SELECT match_id, 'Black', black_player_id
FROM authoritative_matches
WHERE black_player_id IS NOT NULL
UNION ALL
SELECT match_id, 'White', white_player_id
FROM authoritative_matches
WHERE white_player_id IS NOT NULL;
`,
  },
  {
    version: 4,
    name: "add_durable_post_game_presence",
    sql: `
ALTER TABLE authoritative_matches
  ADD COLUMN post_game_presence JSONB;

UPDATE authoritative_matches
SET post_game_presence = jsonb_build_object(
  'Black', jsonb_build_object('presence', 'absent', 'graceExpiresAt', NULL),
  'White', jsonb_build_object('presence', 'absent', 'graceExpiresAt', NULL)
)
WHERE status = 'ended';

ALTER TABLE authoritative_matches
  ADD CONSTRAINT authoritative_matches_post_game_presence_shape CHECK (
    (
      status <> 'ended' AND post_game_presence IS NULL
    ) OR (
      status = 'ended'
      AND jsonb_typeof(post_game_presence) = 'object'
      AND post_game_presence -> 'Black' ->> 'presence' IN ('present', 'grace', 'absent')
      AND post_game_presence -> 'White' ->> 'presence' IN ('present', 'grace', 'absent')
      AND jsonb_typeof(post_game_presence -> 'Black' -> 'graceExpiresAt') IN ('null', 'string')
      AND jsonb_typeof(post_game_presence -> 'White' -> 'graceExpiresAt') IN ('null', 'string')
    )
  );
`,
  },
] as const;

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

/**
 * Applies every authoritative-server migration exactly once.
 *
 * A PostgreSQL advisory lock serializes concurrent application starts. Applied
 * migration checksums are verified so an already-released migration cannot be
 * edited silently.
 */
export async function runPostgresMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS authoritative_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = await client.query<AppliedMigrationRow>(
      "SELECT version, name, checksum FROM authoritative_schema_migrations ORDER BY version",
    );
    const appliedByVersion = new Map(
      applied.rows.map((row) => [row.version, row] as const),
    );

    for (const migration of POSTGRES_MIGRATIONS) {
      const expectedChecksum = checksum(migration.sql);
      const existing = appliedByVersion.get(migration.version);
      if (existing) {
        if (
          existing.name !== migration.name ||
          existing.checksum !== expectedChecksum
        ) {
          throw new Error(
            `PostgreSQL migration ${migration.version} no longer matches the applied checksum.`,
          );
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `
            INSERT INTO authoritative_schema_migrations (version, name, checksum)
            VALUES ($1, $2, $3)
          `,
          [migration.version, migration.name, expectedChecksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    } finally {
      client.release();
    }
  }
}
