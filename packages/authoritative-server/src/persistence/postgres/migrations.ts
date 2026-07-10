import { createHash } from "node:crypto";
import type { Pool } from "pg";

export interface PostgresMigration {
  version: number;
  name: string;
  sql: string;
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

    const applied = await client.query<{
      version: number;
      name: string;
      checksum: string;
    }>(
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
