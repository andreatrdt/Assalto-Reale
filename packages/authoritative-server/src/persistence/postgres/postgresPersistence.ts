import type { Pool, PoolClient } from "pg";
import type { MatchAggregate } from "../../domain/matchAggregate.js";
import {
  CommandAlreadyProcessedError,
  ConcurrencyConflictError,
  ReceiptConflictError,
  type MatchPrecondition,
  type MatchRepository,
  type StoredCommandReceipt,
  type Transaction,
  type UnitOfWork,
} from "../../repositories.js";
import {
  decodeMatchAggregate,
  decodeReceipt,
  encodeMatchAggregate,
  encodeReceipt,
  type PostgresMatchRow,
  type PostgresReceiptRow,
} from "./codec.js";
import { PostgresAccountRepository } from "./postgresAccountRepository.js";
import type { AccountRepository } from "../../accounts.js";

const MATCH_COLUMNS = `
  match_id,
  invite_code,
  version,
  stream_sequence,
  seed,
  config,
  black_player_id,
  white_player_id,
  status,
  state,
  end_reason,
  rematch_offered_by,
  successor_match_id,
  predecessor_match_id,
  post_game_presence
`;

interface StagedMatch {
  aggregate: MatchAggregate;
  precondition: MatchPrecondition;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

async function selectMatch(
  queryable: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  clause: string,
  value: string,
): Promise<MatchAggregate | null> {
  const result = await queryable.query(`SELECT ${MATCH_COLUMNS} FROM authoritative_matches WHERE ${clause} = $1`, [value]);
  const row = result.rows[0] as PostgresMatchRow | undefined;
  return row ? decodeMatchAggregate(row) : null;
}

async function selectReceipt(client: PoolClient, commandId: string): Promise<StoredCommandReceipt | null> {
  const result = await client.query(
    `
      SELECT command_id, player_id, match_id, payload_hash, envelopes
      FROM authoritative_command_receipts
      WHERE command_id = $1
    `,
    [commandId],
  );
  const row = result.rows[0] as PostgresReceiptRow | undefined;
  return row ? decodeReceipt(row) : null;
}

export class PostgresMatchRepository implements MatchRepository {
  constructor(private readonly pool: Pool) {}

  async load(matchId: string): Promise<MatchAggregate | null> {
    return selectMatch(this.pool, "match_id", matchId);
  }

  async findByInviteCode(inviteCode: string): Promise<MatchAggregate | null> {
    return selectMatch(this.pool, "invite_code", inviteCode);
  }
}

class PostgresTransaction implements Transaction {
  private readonly stagedMatches: StagedMatch[] = [];
  private readonly stagedReceipts: StoredCommandReceipt[] = [];

  constructor(private readonly client: PoolClient) {}

  async loadMatch(matchId: string): Promise<MatchAggregate | null> {
    return selectMatch(this.client, "match_id", matchId);
  }

  async findMatchByInviteCode(inviteCode: string): Promise<MatchAggregate | null> {
    return selectMatch(this.client, "invite_code", inviteCode);
  }

  async findReceipt(commandId: string): Promise<StoredCommandReceipt | null> {
    return selectReceipt(this.client, commandId);
  }

  saveMatch(aggregate: MatchAggregate, precondition: MatchPrecondition): void {
    this.stagedMatches.push({ aggregate, precondition });
  }

  saveReceipt(receipt: StoredCommandReceipt): void {
    this.stagedReceipts.push(receipt);
  }

  async commitStaged(): Promise<void> {
    // Receipts are claimed before match writes. A concurrent exact retry therefore
    // replays the already-committed result without creating another match or state
    // transition. Any later failure rolls this receipt insertion back.
    for (const receipt of this.stagedReceipts) {
      await this.claimReceipt(receipt);
    }
    for (const match of this.stagedMatches) {
      await this.persistMatch(match);
    }
  }

  private async claimReceipt(receipt: StoredCommandReceipt): Promise<void> {
    const encoded = encodeReceipt(receipt);
    const inserted = await this.client.query(
      `
        INSERT INTO authoritative_command_receipts (
          command_id,
          player_id,
          match_id,
          payload_hash,
          envelopes
        )
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (command_id) DO NOTHING
        RETURNING command_id
      `,
      [encoded.commandId, encoded.playerId, encoded.matchId, encoded.payloadHash, JSON.stringify(encoded.envelopes)],
    );
    if (inserted.rowCount === 1) return;

    const existing = await selectReceipt(this.client, encoded.commandId);
    if (!existing) {
      throw new Error(`PostgreSQL command receipt ${encoded.commandId} conflicted but could not be loaded.`);
    }
    if (existing.payloadHash !== encoded.payloadHash || existing.playerId !== encoded.playerId) {
      throw new ReceiptConflictError();
    }
    throw new CommandAlreadyProcessedError(existing);
  }

  private async persistMatch(staged: StagedMatch): Promise<void> {
    const encoded = encodeMatchAggregate(staged.aggregate);
    const values: unknown[] = [
      encoded.matchId,
      encoded.inviteCode,
      encoded.version,
      encoded.streamSequence,
      encoded.seed,
      JSON.stringify(encoded.config),
      encoded.blackPlayerId,
      encoded.whitePlayerId,
      encoded.status,
      JSON.stringify(encoded.state),
      encoded.endReason,
      encoded.rematchOfferedBy,
      encoded.successorMatchId,
      encoded.predecessorMatchId,
      encoded.postGame ? JSON.stringify(encoded.postGame) : null,
    ];

    if (staged.precondition.kind === "create") {
      try {
        await this.client.query(
          `
            INSERT INTO authoritative_matches (
              match_id,
              invite_code,
              version,
              stream_sequence,
              seed,
              config,
              black_player_id,
              white_player_id,
              status,
              state,
              end_reason,
              rematch_offered_by,
              successor_match_id,
              predecessor_match_id,
              post_game_presence
            )
            VALUES (
              $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11,
              $12, $13, $14, $15::jsonb
            )
          `,
          values,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConcurrencyConflictError("A match with this id or invite code already exists.");
        }
        throw error;
      }
      await this.syncMemberships(encoded);
      return;
    }

    const updated = await this.client.query(
      `
        UPDATE authoritative_matches
        SET
          invite_code = $2,
          version = $3,
          stream_sequence = $4,
          seed = $5,
          config = $6::jsonb,
          black_player_id = $7,
          white_player_id = $8,
          status = $9,
          state = $10::jsonb,
          end_reason = $11,
          rematch_offered_by = $12,
          successor_match_id = $13,
          predecessor_match_id = $14,
          post_game_presence = $15::jsonb,
          updated_at = NOW()
        WHERE match_id = $1 AND version = $16
      `,
      [...values, staged.precondition.version],
    );
    if (updated.rowCount !== 1) {
      throw new ConcurrencyConflictError();
    }
    await this.syncMemberships(encoded);
  }

  private async syncMemberships(encoded: ReturnType<typeof encodeMatchAggregate>): Promise<void> {
    const members = [
      ["Black", encoded.blackPlayerId],
      ["White", encoded.whitePlayerId],
    ] as const;
    for (const [side, playerId] of members) {
      if (!playerId) {
        await this.client.query("DELETE FROM match_memberships WHERE match_id = $1 AND side = $2", [encoded.matchId, side]);
        continue;
      }
      // Legacy HMAC credentials may have been issued before migration 3. The
      // first authoritative write safely materializes their guest identity.
      await this.client.query(
        `
          INSERT INTO player_identities (player_id, kind)
          VALUES ($1, 'guest')
          ON CONFLICT (player_id) DO NOTHING
        `,
        [playerId],
      );
      await this.client.query(
        `
          INSERT INTO match_memberships (match_id, side, player_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (match_id, side)
          DO UPDATE SET player_id = EXCLUDED.player_id
        `,
        [encoded.matchId, side, playerId],
      );
    }
  }
}

export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: Pool) {}

  async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const transaction = new PostgresTransaction(client);
      const result = await work(transaction);
      await transaction.commitStaged();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export interface PostgresPersistence {
  pool: Pool;
  matches: MatchRepository;
  unitOfWork: UnitOfWork;
  accounts: AccountRepository;
}

export function createPostgresPersistence(pool: Pool): PostgresPersistence {
  return {
    pool,
    matches: new PostgresMatchRepository(pool),
    unitOfWork: new PostgresUnitOfWork(pool),
    accounts: new PostgresAccountRepository(pool),
  };
}
