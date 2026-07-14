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
  {
    version: 5,
    name: "add_immutable_match_history",
    sql: `
ALTER TABLE authoritative_matches
  ADD COLUMN history_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (history_event_sequence >= 0),
  ADD COLUMN history_capture_started_at_version INTEGER CHECK (history_capture_started_at_version > 0);

CREATE TABLE match_history_events (
  match_id TEXT NOT NULL REFERENCES authoritative_matches(match_id) ON DELETE RESTRICT,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'place_piece', 'submit_action', 'choose_defender', 'cancel_defended_king',
    'choose_transform', 'pass_turn', 'resignation', 'timeout'
  )),
  actor_player_identity_id TEXT REFERENCES player_identities(player_id) ON DELETE RESTRICT,
  actor_side TEXT CHECK (actor_side IS NULL OR actor_side IN ('Black', 'White')),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL,
  match_version_before INTEGER NOT NULL CHECK (match_version_before > 0),
  match_version_after INTEGER NOT NULL CHECK (match_version_after > match_version_before),
  replay_schema_version INTEGER NOT NULL CHECK (replay_schema_version > 0),
  PRIMARY KEY (match_id, sequence_number)
);

CREATE TABLE match_history (
  match_id TEXT PRIMARY KEY REFERENCES authoritative_matches(match_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  black_player_identity_id TEXT NOT NULL REFERENCES player_identities(player_id) ON DELETE RESTRICT,
  white_player_identity_id TEXT NOT NULL REFERENCES player_identities(player_id) ON DELETE RESTRICT,
  black_user_id TEXT REFERENCES account_users(user_id) ON DELETE RESTRICT,
  white_user_id TEXT REFERENCES account_users(user_id) ON DELETE RESTRICT,
  winner_player_identity_id TEXT REFERENCES player_identities(player_id) ON DELETE RESTRICT,
  winner_side TEXT CHECK (winner_side IS NULL OR winner_side IN ('Black', 'White')),
  result TEXT NOT NULL CHECK (result IN ('Black', 'White', 'draw')),
  victory_reason TEXT NOT NULL CHECK (victory_reason IN (
    'king_capture', 'territory', 'timeout', 'resignation', 'abandonment'
  )),
  total_turns INTEGER NOT NULL CHECK (total_turns >= 0),
  total_events INTEGER NOT NULL CHECK (total_events >= 0),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  time_control JSONB NOT NULL CHECK (jsonb_typeof(time_control) = 'object'),
  rated BOOLEAN NOT NULL DEFAULT FALSE CHECK (rated = FALSE),
  predecessor_match_id TEXT,
  final_match_version INTEGER NOT NULL CHECK (final_match_version > 0),
  rules_version INTEGER NOT NULL CHECK (rules_version > 0),
  protocol_version INTEGER NOT NULL CHECK (protocol_version > 0),
  replay_schema_version INTEGER NOT NULL CHECK (replay_schema_version > 0),
  replay_available BOOLEAN NOT NULL,
  seed BIGINT NOT NULL,
  config JSONB NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  final_snapshot JSONB NOT NULL CHECK (jsonb_typeof(final_snapshot) = 'object'),
  created_from_authoritative_match_version INTEGER NOT NULL CHECK (created_from_authoritative_match_version > 0),
  black_statistics JSONB NOT NULL CHECK (jsonb_typeof(black_statistics) = 'object'),
  white_statistics JSONB NOT NULL CHECK (jsonb_typeof(white_statistics) = 'object'),
  history_generation_complete BOOLEAN NOT NULL DEFAULT TRUE CHECK (history_generation_complete = TRUE),
  integrity_checksum TEXT NOT NULL CHECK (integrity_checksum ~ '^[a-f0-9]{64}$')
);

CREATE INDEX match_history_black_player_idx
  ON match_history (black_player_identity_id, completed_at DESC, match_id DESC);
CREATE INDEX match_history_white_player_idx
  ON match_history (white_player_identity_id, completed_at DESC, match_id DESC);
CREATE INDEX match_history_completed_idx
  ON match_history (completed_at DESC, match_id DESC);

CREATE TABLE match_history_successors (
  predecessor_match_id TEXT PRIMARY KEY REFERENCES match_history(match_id) ON DELETE RESTRICT,
  successor_match_id TEXT NOT NULL UNIQUE REFERENCES authoritative_matches(match_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE player_statistics (
  user_id TEXT PRIMARY KEY REFERENCES account_users(user_id) ON DELETE RESTRICT,
  games_played BIGINT NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  wins BIGINT NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses BIGINT NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws BIGINT NOT NULL DEFAULT 0 CHECK (draws >= 0),
  king_capture_wins BIGINT NOT NULL DEFAULT 0 CHECK (king_capture_wins >= 0),
  territory_wins BIGINT NOT NULL DEFAULT 0 CHECK (territory_wins >= 0),
  timeout_wins BIGINT NOT NULL DEFAULT 0 CHECK (timeout_wins >= 0),
  resignation_wins BIGINT NOT NULL DEFAULT 0 CHECK (resignation_wins >= 0),
  black_games BIGINT NOT NULL DEFAULT 0 CHECK (black_games >= 0),
  black_wins BIGINT NOT NULL DEFAULT 0 CHECK (black_wins >= 0),
  white_games BIGINT NOT NULL DEFAULT 0 CHECK (white_games >= 0),
  white_wins BIGINT NOT NULL DEFAULT 0 CHECK (white_wins >= 0),
  total_turns BIGINT NOT NULL DEFAULT 0 CHECK (total_turns >= 0),
  total_duration_seconds BIGINT NOT NULL DEFAULT 0 CHECK (total_duration_seconds >= 0),
  captures_made BIGINT NOT NULL DEFAULT 0 CHECK (captures_made >= 0),
  pieces_lost BIGINT NOT NULL DEFAULT 0 CHECK (pieces_lost >= 0),
  transformations BIGINT NOT NULL DEFAULT 0 CHECK (transformations >= 0),
  defended_king_sacrifices BIGINT NOT NULL DEFAULT 0 CHECK (defended_king_sacrifices >= 0),
  territory_claims_created BIGINT NOT NULL DEFAULT 0 CHECK (territory_claims_created >= 0),
  current_win_streak BIGINT NOT NULL DEFAULT 0 CHECK (current_win_streak >= 0),
  longest_win_streak BIGINT NOT NULL DEFAULT 0 CHECK (longest_win_streak >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0)
);

WITH terminal_results AS (
  SELECT
    match.match_id,
    COALESCE(
      match.state -> 'victory' ->> 'winner',
      terminal_event.envelope -> 'event' ->> 'winner'
    ) AS winner_side
  FROM authoritative_matches match
  LEFT JOIN LATERAL (
    SELECT envelope
    FROM authoritative_command_receipts receipt
    CROSS JOIN LATERAL jsonb_array_elements(receipt.envelopes) envelope
    WHERE receipt.match_id = match.match_id
      AND envelope -> 'event' ->> 'type' = 'MatchEnded'
    ORDER BY receipt.created_at DESC
    LIMIT 1
  ) terminal_event ON TRUE
  WHERE match.status = 'ended'
)
INSERT INTO match_history (
  match_id, created_at, started_at, completed_at,
  black_player_identity_id, white_player_identity_id,
  black_user_id, white_user_id, winner_player_identity_id, winner_side, result,
  victory_reason, total_turns, total_events, duration_seconds, time_control,
  predecessor_match_id, final_match_version, rules_version, protocol_version,
  replay_schema_version, replay_available, seed, config, final_snapshot,
  created_from_authoritative_match_version, black_statistics, white_statistics,
  integrity_checksum
)
SELECT
  match.match_id,
  match.created_at,
  match.created_at,
  match.updated_at,
  match.black_player_id,
  match.white_player_id,
  black_identity.user_id,
  white_identity.user_id,
  CASE terminal.winner_side
    WHEN 'Black' THEN match.black_player_id
    WHEN 'White' THEN match.white_player_id
    ELSE NULL
  END,
  CASE WHEN terminal.winner_side IN ('Black', 'White') THEN terminal.winner_side ELSE NULL END,
  CASE WHEN terminal.winner_side IN ('Black', 'White') THEN terminal.winner_side ELSE 'draw' END,
  match.end_reason,
  COALESCE((match.state ->> 'turnCounter')::INTEGER, 0),
  0,
  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (match.updated_at - match.created_at)))::INTEGER),
  match.config -> 'timeControl',
  match.predecessor_match_id,
  match.version,
  1,
  1,
  1,
  FALSE,
  match.seed,
  match.config,
  match.state,
  match.version,
  '{"capturesMade":0,"piecesLost":0,"transformations":0,"defendedKingSacrifices":0,"territoryClaimsCreated":0}'::jsonb,
  '{"capturesMade":0,"piecesLost":0,"transformations":0,"defendedKingSacrifices":0,"territoryClaimsCreated":0}'::jsonb,
  md5(match.match_id || ':' || match.version::TEXT || ':' || match.updated_at::TEXT)
    || md5(match.updated_at::TEXT || ':' || match.match_id)
FROM authoritative_matches match
JOIN terminal_results terminal ON terminal.match_id = match.match_id
JOIN player_identities black_identity ON black_identity.player_id = match.black_player_id
JOIN player_identities white_identity ON white_identity.player_id = match.white_player_id
WHERE match.status = 'ended'
  AND match.end_reason IS NOT NULL
  AND match.black_player_id IS NOT NULL
  AND match.white_player_id IS NOT NULL;

WITH user_matches AS (
  SELECT black_user_id AS user_id, 'Black'::TEXT AS side, winner_side, victory_reason, total_turns, duration_seconds
  FROM match_history WHERE black_user_id IS NOT NULL
  UNION ALL
  SELECT white_user_id, 'White', winner_side, victory_reason, total_turns, duration_seconds
  FROM match_history WHERE white_user_id IS NOT NULL
)
INSERT INTO player_statistics (
  user_id, games_played, wins, losses, draws,
  king_capture_wins, territory_wins, timeout_wins, resignation_wins,
  black_games, black_wins, white_games, white_wins,
  total_turns, total_duration_seconds
)
SELECT
  user_id,
  COUNT(*),
  COUNT(*) FILTER (WHERE winner_side = side),
  COUNT(*) FILTER (WHERE winner_side IS NOT NULL AND winner_side <> side),
  COUNT(*) FILTER (WHERE winner_side IS NULL),
  COUNT(*) FILTER (WHERE winner_side = side AND victory_reason = 'king_capture'),
  COUNT(*) FILTER (WHERE winner_side = side AND victory_reason = 'territory'),
  COUNT(*) FILTER (WHERE winner_side = side AND victory_reason = 'timeout'),
  COUNT(*) FILTER (WHERE winner_side = side AND victory_reason = 'resignation'),
  COUNT(*) FILTER (WHERE side = 'Black'),
  COUNT(*) FILTER (WHERE side = 'Black' AND winner_side = side),
  COUNT(*) FILTER (WHERE side = 'White'),
  COUNT(*) FILTER (WHERE side = 'White' AND winner_side = side),
  SUM(total_turns),
  SUM(duration_seconds)
FROM user_matches
GROUP BY user_id;

CREATE FUNCTION reject_immutable_match_history_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'completed match history is immutable';
END;
$$;

CREATE TRIGGER match_history_no_update_or_delete
BEFORE UPDATE OR DELETE ON match_history
FOR EACH ROW EXECUTE FUNCTION reject_immutable_match_history_mutation();

CREATE TRIGGER match_history_events_no_update_or_delete
BEFORE UPDATE OR DELETE ON match_history_events
FOR EACH ROW EXECUTE FUNCTION reject_immutable_match_history_mutation();

CREATE TRIGGER match_history_successors_no_update_or_delete
BEFORE UPDATE OR DELETE ON match_history_successors
FOR EACH ROW EXECUTE FUNCTION reject_immutable_match_history_mutation();

CREATE FUNCTION reject_late_match_history_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM match_history WHERE match_id = NEW.match_id) THEN
    RAISE EXCEPTION 'cannot append replay events after history finalization';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER match_history_events_no_late_append
BEFORE INSERT ON match_history_events
FOR EACH ROW EXECUTE FUNCTION reject_late_match_history_event();
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
