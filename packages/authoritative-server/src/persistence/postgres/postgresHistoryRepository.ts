import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  MatchHistoryDetails,
  MatchHistoryPage,
  MatchHistoryParticipant,
  MatchHistoryPerspectiveResult,
  PlayerSide,
  PlayerStatisticsSummary,
} from "@assalto-reale/multiplayer-protocol";
import type { MatchAggregate } from "../../domain/matchAggregate.js";
import {
  buildImmutableMatchHistory,
  emptyPlayerStatistics,
  applyMatchToPlayerStatistics,
  type HistoryCompletionContext,
  type HistoryStorageMetrics,
  type ImmutableMatchHistoryRecord,
  type MatchHistoryFilters,
  type MatchHistoryRepository,
  type OperationalCleanupResult,
  type OperationalMaintenanceRepository,
  type PerSideHistoryFacts,
  type StoredHistoryEvent,
} from "../../history.js";

interface HistoryEventRow extends QueryResultRow {
  match_id: string;
  sequence_number: number;
  event_type: StoredHistoryEvent["eventType"];
  actor_player_identity_id: string | null;
  actor_side: PlayerSide | null;
  payload: StoredHistoryEvent["payload"];
  occurred_at: Date | string;
  match_version_before: number;
  match_version_after: number;
}

interface HistoryRow extends QueryResultRow {
  match_id: string;
  created_at: Date | string;
  started_at: Date | string;
  completed_at: Date | string;
  black_player_identity_id: string;
  white_player_identity_id: string;
  black_user_id: string | null;
  white_user_id: string | null;
  black_kind: "guest" | "registered";
  white_kind: "guest" | "registered";
  winner_side: PlayerSide | null;
  victory_reason: ImmutableMatchHistoryRecord["victoryReason"];
  total_turns: number | string;
  total_events: number | string;
  duration_seconds: number | string;
  predecessor_match_id: string | null;
  successor_match_id: string | null;
  final_match_version: number | string;
  rules_version: number | string;
  protocol_version: number | string;
  replay_schema_version: number | string;
  replay_available: boolean;
  integrity_checksum: string;
  seed: number | string;
  config: ImmutableMatchHistoryRecord["config"];
  final_snapshot: ImmutableMatchHistoryRecord["finalSnapshot"];
  black_statistics: PerSideHistoryFacts;
  white_statistics: PerSideHistoryFacts;
  black_current_user_id: string | null;
  white_current_user_id: string | null;
}

function integer(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error("Corrupt match-history integer.");
  return parsed;
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error("Corrupt match-history timestamp.");
  return date.toISOString();
}

function participant(
  side: PlayerSide,
  row: HistoryRow,
): MatchHistoryParticipant {
  const kind = side === "Black" ? row.black_kind : row.white_kind;
  return {
    side,
    kind,
    displayIdentity:
      kind === "registered" ? "Registered player" : "Guest player",
  };
}

function viewerSide(row: HistoryRow, userId: string): PlayerSide | null {
  const black = row.black_current_user_id === userId;
  const white = row.white_current_user_id === userId;
  if (black && white)
    throw new Error(
      "A single account cannot own both historical participants.",
    );
  return black ? "Black" : white ? "White" : null;
}

function perspective(
  winner: PlayerSide | null,
  side: PlayerSide,
): MatchHistoryPerspectiveResult {
  return winner === null ? "draw" : winner === side ? "win" : "loss";
}

function decodeCursor(cursor: string): {
  completedAt: string;
  matchId: string;
} {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      typeof value.completedAt !== "string" ||
      !Number.isFinite(Date.parse(value.completedAt)) ||
      typeof value.matchId !== "string" ||
      value.matchId.length < 1 ||
      value.matchId.length > 256
    ) {
      throw new Error("invalid");
    }
    return { completedAt: value.completedAt, matchId: value.matchId };
  } catch {
    throw new Error("The match-history cursor is invalid.");
  }
}

function encodeCursor(row: HistoryRow): string {
  return Buffer.from(
    JSON.stringify({
      completedAt: iso(row.completed_at),
      matchId: row.match_id,
    }),
    "utf8",
  ).toString("base64url");
}

const HISTORY_SELECT = `
  history.*,
  black_identity.kind AS black_kind,
  white_identity.kind AS white_kind,
  black_identity.user_id AS black_current_user_id,
  white_identity.user_id AS white_current_user_id,
  successor.successor_match_id
FROM match_history history
JOIN player_identities black_identity ON black_identity.player_id = history.black_player_identity_id
JOIN player_identities white_identity ON white_identity.player_id = history.white_player_identity_id
LEFT JOIN match_history_successors successor ON successor.predecessor_match_id = history.match_id
`;

function eventFromRow(row: HistoryEventRow): StoredHistoryEvent {
  return {
    sequenceNumber: integer(row.sequence_number),
    eventType: row.event_type,
    actorPlayerId: row.actor_player_identity_id,
    actorSide: row.actor_side,
    occurredAt: iso(row.occurred_at),
    matchVersionBefore: integer(row.match_version_before),
    matchVersionAfter: integer(row.match_version_after),
    payload: row.payload,
  };
}

async function loadEvents(
  client: PoolClient,
  matchId: string,
): Promise<StoredHistoryEvent[]> {
  const result = await client.query<HistoryEventRow>(
    `SELECT * FROM match_history_events WHERE match_id = $1 ORDER BY sequence_number`,
    [matchId],
  );
  return result.rows.map(eventFromRow);
}

export async function appendPostgresHistoryEvent(
  client: PoolClient,
  matchId: string,
  event: StoredHistoryEvent,
): Promise<void> {
  const inserted = await client.query(
    `
      INSERT INTO match_history_events (
        match_id, sequence_number, event_type, actor_player_identity_id, actor_side,
        payload, occurred_at, match_version_before, match_version_after, replay_schema_version
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
      ON CONFLICT (match_id, sequence_number) DO NOTHING
      RETURNING sequence_number
    `,
    [
      matchId,
      event.sequenceNumber,
      event.eventType,
      event.actorPlayerId,
      event.actorSide,
      JSON.stringify(event.payload),
      event.occurredAt,
      event.matchVersionBefore,
      event.matchVersionAfter,
      event.payload.schemaVersion,
    ],
  );
  if (inserted.rowCount === 1) return;
  const existing = (await loadEvents(client, matchId)).find(
    (candidate) => candidate.sequenceNumber === event.sequenceNumber,
  );
  if (!existing || JSON.stringify(existing) !== JSON.stringify(event)) {
    throw new Error(
      `Replay event ${matchId}/${event.sequenceNumber} conflicts with immutable history.`,
    );
  }
}

async function completionContext(
  client: PoolClient,
  aggregate: MatchAggregate,
  completedAt: Date,
  events: StoredHistoryEvent[],
): Promise<HistoryCompletionContext> {
  const result = await client.query<{
    created_at: Date;
    black_user_id: string | null;
    white_user_id: string | null;
  }>(
    `
      SELECT match.created_at,
             black_identity.user_id AS black_user_id,
             white_identity.user_id AS white_user_id
      FROM authoritative_matches match
      JOIN player_identities black_identity ON black_identity.player_id = match.black_player_id
      JOIN player_identities white_identity ON white_identity.player_id = match.white_player_id
      WHERE match.match_id = $1
    `,
    [aggregate.matchId],
  );
  const row = result.rows[0];
  if (!row)
    throw new Error("The completed match identities could not be resolved.");
  const createdAt = iso(row.created_at);
  return {
    createdAt,
    startedAt: events[0]?.occurredAt ?? createdAt,
    completedAt: completedAt.toISOString(),
    blackUserId: row.black_user_id,
    whiteUserId: row.white_user_id,
  };
}

function factsFor(
  record: ImmutableMatchHistoryRecord,
  side: PlayerSide,
): PerSideHistoryFacts {
  return side === "Black" ? record.blackFacts : record.whiteFacts;
}

async function applyStatisticsDelta(
  client: PoolClient,
  userId: string,
  side: PlayerSide,
  record: ImmutableMatchHistoryRecord,
): Promise<void> {
  const won = record.winnerSide === side;
  const lost = record.winnerSide !== null && !won;
  const drew = record.winnerSide === null;
  const sideFacts = factsFor(record, side);
  await client.query(
    `
      INSERT INTO player_statistics (
        user_id, games_played, wins, losses, draws,
        king_capture_wins, territory_wins, timeout_wins, resignation_wins,
        black_games, black_wins, white_games, white_wins,
        total_turns, total_duration_seconds, captures_made, pieces_lost,
        transformations, defended_king_sacrifices, territory_claims_created,
        current_win_streak, longest_win_streak
      ) VALUES (
        $1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20, $20
      )
      ON CONFLICT (user_id) DO UPDATE SET
        games_played = player_statistics.games_played + 1,
        wins = player_statistics.wins + EXCLUDED.wins,
        losses = player_statistics.losses + EXCLUDED.losses,
        draws = player_statistics.draws + EXCLUDED.draws,
        king_capture_wins = player_statistics.king_capture_wins + EXCLUDED.king_capture_wins,
        territory_wins = player_statistics.territory_wins + EXCLUDED.territory_wins,
        timeout_wins = player_statistics.timeout_wins + EXCLUDED.timeout_wins,
        resignation_wins = player_statistics.resignation_wins + EXCLUDED.resignation_wins,
        black_games = player_statistics.black_games + EXCLUDED.black_games,
        black_wins = player_statistics.black_wins + EXCLUDED.black_wins,
        white_games = player_statistics.white_games + EXCLUDED.white_games,
        white_wins = player_statistics.white_wins + EXCLUDED.white_wins,
        total_turns = player_statistics.total_turns + EXCLUDED.total_turns,
        total_duration_seconds = player_statistics.total_duration_seconds + EXCLUDED.total_duration_seconds,
        captures_made = player_statistics.captures_made + EXCLUDED.captures_made,
        pieces_lost = player_statistics.pieces_lost + EXCLUDED.pieces_lost,
        transformations = player_statistics.transformations + EXCLUDED.transformations,
        defended_king_sacrifices = player_statistics.defended_king_sacrifices + EXCLUDED.defended_king_sacrifices,
        territory_claims_created = player_statistics.territory_claims_created + EXCLUDED.territory_claims_created,
        current_win_streak = CASE WHEN $21 THEN player_statistics.current_win_streak + 1 ELSE 0 END,
        longest_win_streak = CASE WHEN $21
          THEN GREATEST(player_statistics.longest_win_streak, player_statistics.current_win_streak + 1)
          ELSE player_statistics.longest_win_streak END,
        updated_at = NOW(),
        version = player_statistics.version + 1
    `,
    [
      userId,
      won ? 1 : 0,
      lost ? 1 : 0,
      drew ? 1 : 0,
      won && record.victoryReason === "king_capture" ? 1 : 0,
      won && record.victoryReason === "territory" ? 1 : 0,
      won && record.victoryReason === "timeout" ? 1 : 0,
      won && record.victoryReason === "resignation" ? 1 : 0,
      side === "Black" ? 1 : 0,
      side === "Black" && won ? 1 : 0,
      side === "White" ? 1 : 0,
      side === "White" && won ? 1 : 0,
      record.totalTurns,
      record.durationSeconds,
      sideFacts.capturesMade,
      sideFacts.piecesLost,
      sideFacts.transformations,
      sideFacts.defendedKingSacrifices,
      sideFacts.territoryClaimsCreated,
      won ? 1 : 0,
      won,
    ],
  );
}

async function insertHistory(
  client: PoolClient,
  record: ImmutableMatchHistoryRecord,
): Promise<boolean> {
  const winnerPlayerId =
    record.winnerSide === "Black"
      ? record.blackPlayerId
      : record.winnerSide === "White"
        ? record.whitePlayerId
        : null;
  const inserted = await client.query(
    `
      INSERT INTO match_history (
        match_id, created_at, started_at, completed_at,
        black_player_identity_id, white_player_identity_id, black_user_id, white_user_id,
        winner_player_identity_id, winner_side, result, victory_reason,
        total_turns, total_events, duration_seconds, time_control, rated,
        predecessor_match_id, final_match_version, rules_version, protocol_version,
        replay_schema_version, replay_available, seed, config, final_snapshot,
        created_from_authoritative_match_version, black_statistics, white_statistics,
        integrity_checksum
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16::jsonb, $17, $18, $19, $20, $21, $22, $23, $24, $25::jsonb,
        $26::jsonb, $27, $28::jsonb, $29::jsonb, $30
      )
      ON CONFLICT (match_id) DO NOTHING
      RETURNING match_id
    `,
    [
      record.matchId,
      record.createdAt,
      record.startedAt,
      record.completedAt,
      record.blackPlayerId,
      record.whitePlayerId,
      record.blackUserId,
      record.whiteUserId,
      winnerPlayerId,
      record.winnerSide,
      record.result,
      record.victoryReason,
      record.totalTurns,
      record.totalEvents,
      record.durationSeconds,
      JSON.stringify(record.timeControl),
      record.rated,
      record.predecessorMatchId,
      record.finalMatchVersion,
      record.rulesVersion,
      record.protocolVersion,
      record.replaySchemaVersion,
      record.replayAvailable,
      record.seed,
      JSON.stringify(record.config),
      JSON.stringify(record.finalSnapshot),
      record.createdFromAuthoritativeMatchVersion,
      JSON.stringify(record.blackFacts),
      JSON.stringify(record.whiteFacts),
      record.integrityChecksum,
    ],
  );
  if (inserted.rowCount === 1) return true;
  const existing = await client.query<{ integrity_checksum: string }>(
    "SELECT integrity_checksum FROM match_history WHERE match_id = $1",
    [record.matchId],
  );
  if (existing.rows[0]?.integrity_checksum !== record.integrityChecksum) {
    throw new Error(
      `Immutable history for ${record.matchId} conflicts with the authoritative completion.`,
    );
  }
  return false;
}

export async function finalizePostgresHistory(
  client: PoolClient,
  aggregate: MatchAggregate,
  completedAt: Date,
): Promise<void> {
  const events = await loadEvents(client, aggregate.matchId);
  const context = await completionContext(
    client,
    aggregate,
    completedAt,
    events,
  );
  const record = buildImmutableMatchHistory(aggregate, events, context);
  if (!(await insertHistory(client, record))) return;
  if (
    record.blackUserId &&
    record.whiteUserId &&
    record.blackUserId === record.whiteUserId
  ) {
    throw new Error(
      "A single account cannot receive statistics for both sides of a match.",
    );
  }
  if (record.blackUserId)
    await applyStatisticsDelta(client, record.blackUserId, "Black", record);
  if (record.whiteUserId)
    await applyStatisticsDelta(client, record.whiteUserId, "White", record);
}

export async function linkPostgresHistorySuccessor(
  client: PoolClient,
  predecessorMatchId: string,
  successorMatchId: string,
): Promise<void> {
  const inserted = await client.query(
    `
      INSERT INTO match_history_successors (predecessor_match_id, successor_match_id)
      VALUES ($1, $2)
      ON CONFLICT (predecessor_match_id) DO NOTHING
      RETURNING predecessor_match_id
    `,
    [predecessorMatchId, successorMatchId],
  );
  if (inserted.rowCount === 1) return;
  const existing = await client.query<{ successor_match_id: string }>(
    "SELECT successor_match_id FROM match_history_successors WHERE predecessor_match_id = $1",
    [predecessorMatchId],
  );
  if (existing.rows[0]?.successor_match_id !== successorMatchId) {
    throw new Error(
      `Historical successor for ${predecessorMatchId} is already committed.`,
    );
  }
}

interface StatisticsHistoryRow extends QueryResultRow {
  match_id: string;
  completed_at: Date | string;
  black_player_identity_id: string;
  white_player_identity_id: string;
  black_current_user_id: string | null;
  white_current_user_id: string | null;
  winner_side: PlayerSide | null;
  victory_reason: ImmutableMatchHistoryRecord["victoryReason"];
  total_turns: number | string;
  duration_seconds: number | string;
  black_statistics: PerSideHistoryFacts;
  white_statistics: PerSideHistoryFacts;
}

/** Rebuilds the account aggregate after a guest identity is claimed.
 *
 * History rows stay immutable: ownership is resolved through the mutable identity
 * mapping, while this derived row is replaced transactionally from all visible
 * completed matches. That also makes repeated claims idempotent.
 */
export async function rebuildPostgresPlayerStatistics(
  client: PoolClient,
  userId: string,
): Promise<void> {
  const histories = await client.query<StatisticsHistoryRow>(
    `
      SELECT history.match_id, history.completed_at,
             history.black_player_identity_id, history.white_player_identity_id,
             black_identity.user_id AS black_current_user_id,
             white_identity.user_id AS white_current_user_id,
             history.winner_side, history.victory_reason, history.total_turns,
             history.duration_seconds, history.black_statistics, history.white_statistics
      FROM match_history history
      JOIN player_identities black_identity
        ON black_identity.player_id = history.black_player_identity_id
      JOIN player_identities white_identity
        ON white_identity.player_id = history.white_player_identity_id
      WHERE black_identity.user_id = $1 OR white_identity.user_id = $1
      ORDER BY history.completed_at, history.match_id
    `,
    [userId],
  );

  let statistics = emptyPlayerStatistics();
  for (const row of histories.rows) {
    const ownsBlack = row.black_current_user_id === userId;
    const ownsWhite = row.white_current_user_id === userId;
    if (ownsBlack === ownsWhite) {
      throw new Error(
        "A single account must own exactly one side of each historical match.",
      );
    }
    statistics = applyMatchToPlayerStatistics(
      statistics,
      {
        winnerSide: row.winner_side,
        victoryReason: row.victory_reason,
        totalTurns: integer(row.total_turns),
        durationSeconds: integer(row.duration_seconds),
        blackFacts: row.black_statistics,
        whiteFacts: row.white_statistics,
        completedAt: iso(row.completed_at),
      },
      ownsBlack ? "Black" : "White",
    );
  }

  if (statistics.gamesPlayed === 0) {
    await client.query("DELETE FROM player_statistics WHERE user_id = $1", [
      userId,
    ]);
    return;
  }
  await client.query(
    `
      INSERT INTO player_statistics (
        user_id, games_played, wins, losses, draws,
        king_capture_wins, territory_wins, timeout_wins, resignation_wins,
        black_games, black_wins, white_games, white_wins,
        total_turns, total_duration_seconds, captures_made, pieces_lost,
        transformations, defended_king_sacrifices, territory_claims_created,
        current_win_streak, longest_win_streak, updated_at, version
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
      )
      ON CONFLICT (user_id) DO UPDATE SET
        games_played = EXCLUDED.games_played,
        wins = EXCLUDED.wins,
        losses = EXCLUDED.losses,
        draws = EXCLUDED.draws,
        king_capture_wins = EXCLUDED.king_capture_wins,
        territory_wins = EXCLUDED.territory_wins,
        timeout_wins = EXCLUDED.timeout_wins,
        resignation_wins = EXCLUDED.resignation_wins,
        black_games = EXCLUDED.black_games,
        black_wins = EXCLUDED.black_wins,
        white_games = EXCLUDED.white_games,
        white_wins = EXCLUDED.white_wins,
        total_turns = EXCLUDED.total_turns,
        total_duration_seconds = EXCLUDED.total_duration_seconds,
        captures_made = EXCLUDED.captures_made,
        pieces_lost = EXCLUDED.pieces_lost,
        transformations = EXCLUDED.transformations,
        defended_king_sacrifices = EXCLUDED.defended_king_sacrifices,
        territory_claims_created = EXCLUDED.territory_claims_created,
        current_win_streak = EXCLUDED.current_win_streak,
        longest_win_streak = EXCLUDED.longest_win_streak,
        updated_at = EXCLUDED.updated_at,
        version = EXCLUDED.version
    `,
    [
      userId,
      statistics.gamesPlayed,
      statistics.wins,
      statistics.losses,
      statistics.draws,
      statistics.kingCaptureWins,
      statistics.territoryWins,
      statistics.timeoutWins,
      statistics.resignationWins,
      statistics.blackGames,
      statistics.blackWins,
      statistics.whiteGames,
      statistics.whiteWins,
      statistics.totalTurns,
      statistics.totalDurationSeconds,
      statistics.capturesMade,
      statistics.piecesLost,
      statistics.transformations,
      statistics.defendedKingSacrifices,
      statistics.territoryClaimsCreated,
      statistics.currentWinStreak,
      statistics.longestWinStreak,
      statistics.updatedAt,
      statistics.version,
    ],
  );
}

export class PostgresMatchHistoryRepository implements MatchHistoryRepository {
  constructor(private readonly pool: Pool) {}

  async listForUser(
    userId: string,
    filters: MatchHistoryFilters,
  ): Promise<MatchHistoryPage> {
    const limit = Math.min(50, Math.max(1, filters.limit ?? 20));
    const values: unknown[] = [userId];
    const where = [
      "(black_identity.user_id = $1 OR white_identity.user_id = $1)",
    ];
    if (filters.cursor) {
      const cursor = decodeCursor(filters.cursor);
      values.push(cursor.completedAt, cursor.matchId);
      where.push(
        `(history.completed_at, history.match_id) < ($${values.length - 1}::timestamptz, $${values.length})`,
      );
    }
    if (filters.side) {
      values.push(filters.side);
      where.push(
        `CASE WHEN black_identity.user_id = $1 THEN 'Black' ELSE 'White' END = $${values.length}`,
      );
    }
    if (filters.victoryReason) {
      values.push(filters.victoryReason);
      where.push(`history.victory_reason = $${values.length}`);
    }
    if (filters.result) {
      values.push(filters.result);
      where.push(`CASE
        WHEN history.winner_side IS NULL THEN 'draw'
        WHEN (black_identity.user_id = $1 AND history.winner_side = 'Black')
          OR (white_identity.user_id = $1 AND history.winner_side = 'White') THEN 'win'
        ELSE 'loss' END = $${values.length}`);
    }
    if (filters.completedFrom) {
      values.push(filters.completedFrom);
      where.push(`history.completed_at >= $${values.length}::timestamptz`);
    }
    if (filters.completedTo) {
      values.push(filters.completedTo);
      where.push(`history.completed_at <= $${values.length}::timestamptz`);
    }
    values.push(limit + 1);
    const result = await this.pool.query<HistoryRow>(
      `SELECT ${HISTORY_SELECT} WHERE ${where.join(" AND ")}
       ORDER BY history.completed_at DESC, history.match_id DESC LIMIT $${values.length}`,
      values,
    );
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    return {
      matches: rows.map((row) => {
        const side = viewerSide(row, userId)!;
        const opponentSide = side === "Black" ? "White" : "Black";
        return {
          matchId: row.match_id,
          completedAt: iso(row.completed_at),
          opponent: participant(opponentSide, row),
          side,
          result: perspective(row.winner_side, side),
          victoryReason: row.victory_reason,
          durationSeconds: integer(row.duration_seconds),
          turnCount: integer(row.total_turns),
          predecessorMatchId: row.predecessor_match_id,
          successorMatchId: row.successor_match_id,
          replayAvailable: row.replay_available,
        };
      }),
      nextCursor: hasMore && rows.at(-1) ? encodeCursor(rows.at(-1)!) : null,
    };
  }

  async getForUser(
    userId: string,
    matchId: string,
  ): Promise<MatchHistoryDetails | null> {
    const result = await this.pool.query<HistoryRow>(
      `SELECT ${HISTORY_SELECT}
       WHERE history.match_id = $1 AND (black_identity.user_id = $2 OR white_identity.user_id = $2)`,
      [matchId, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const side = viewerSide(row, userId);
    if (!side) return null;
    const events = await this.pool.query<HistoryEventRow>(
      "SELECT * FROM match_history_events WHERE match_id = $1 ORDER BY sequence_number",
      [matchId],
    );
    return {
      matchId: row.match_id,
      createdAt: iso(row.created_at),
      startedAt: iso(row.started_at),
      completedAt: iso(row.completed_at),
      players: {
        Black: participant("Black", row),
        White: participant("White", row),
      },
      viewerSide: side,
      result: perspective(row.winner_side, side),
      winner: row.winner_side,
      victoryReason: row.victory_reason,
      durationSeconds: integer(row.duration_seconds),
      turnCount: integer(row.total_turns),
      predecessorMatchId: row.predecessor_match_id,
      successorMatchId: row.successor_match_id,
      finalMatchVersion: integer(row.final_match_version),
      rulesVersion: integer(row.rules_version),
      protocolVersion: integer(row.protocol_version),
      replaySchemaVersion: integer(row.replay_schema_version),
      replayAvailable: row.replay_available,
      integrityChecksum: row.integrity_checksum,
      seed: integer(row.seed),
      config: row.config,
      finalSnapshot: row.final_snapshot,
      statistics: { Black: row.black_statistics, White: row.white_statistics },
      events: events.rows.map((event) => {
        const stored = eventFromRow(event);
        return {
          sequenceNumber: stored.sequenceNumber,
          eventType: stored.eventType,
          actorSide: stored.actorSide,
          occurredAt: stored.occurredAt,
          matchVersionBefore: stored.matchVersionBefore,
          matchVersionAfter: stored.matchVersionAfter,
          payload: {
            schemaVersion: stored.payload.schemaVersion,
            command: stored.payload.command,
          },
        };
      }),
    };
  }

  async statisticsForUser(userId: string): Promise<PlayerStatisticsSummary> {
    const result = await this.pool.query<QueryResultRow>(
      "SELECT * FROM player_statistics WHERE user_id = $1",
      [userId],
    );
    const row = result.rows[0] as
      Record<string, number | string | Date> | undefined;
    if (!row) return emptyPlayerStatistics();
    return {
      gamesPlayed: integer(row.games_played as number | string),
      wins: integer(row.wins as number | string),
      losses: integer(row.losses as number | string),
      draws: integer(row.draws as number | string),
      kingCaptureWins: integer(row.king_capture_wins as number | string),
      territoryWins: integer(row.territory_wins as number | string),
      timeoutWins: integer(row.timeout_wins as number | string),
      resignationWins: integer(row.resignation_wins as number | string),
      blackGames: integer(row.black_games as number | string),
      blackWins: integer(row.black_wins as number | string),
      whiteGames: integer(row.white_games as number | string),
      whiteWins: integer(row.white_wins as number | string),
      totalTurns: integer(row.total_turns as number | string),
      totalDurationSeconds: integer(
        row.total_duration_seconds as number | string,
      ),
      capturesMade: integer(row.captures_made as number | string),
      piecesLost: integer(row.pieces_lost as number | string),
      transformations: integer(row.transformations as number | string),
      defendedKingSacrifices: integer(
        row.defended_king_sacrifices as number | string,
      ),
      territoryClaimsCreated: integer(
        row.territory_claims_created as number | string,
      ),
      currentWinStreak: integer(row.current_win_streak as number | string),
      longestWinStreak: integer(row.longest_win_streak as number | string),
      updatedAt: iso(row.updated_at as Date),
      version: integer(row.version as number | string),
    };
  }
}

export class PostgresOperationalMaintenanceRepository implements OperationalMaintenanceRepository {
  constructor(private readonly pool: Pool) {}

  async cleanupTransientRecords(input: {
    before: Date;
    limit: number;
  }): Promise<OperationalCleanupResult> {
    const limit = Math.min(10_000, Math.max(1, input.limit));
    const receipts = await this.pool.query(
      `WITH selected AS (
         SELECT command_id FROM authoritative_command_receipts
         WHERE created_at < $1 ORDER BY created_at LIMIT $2
       ) DELETE FROM authoritative_command_receipts receipt
         USING selected WHERE receipt.command_id = selected.command_id`,
      [input.before, limit],
    );
    const tickets = await this.pool.query(
      `WITH selected AS (
         SELECT ticket_hash FROM registered_websocket_tickets
         WHERE COALESCE(consumed_at, expires_at) < $1 ORDER BY COALESCE(consumed_at, expires_at) LIMIT $2
       ) DELETE FROM registered_websocket_tickets ticket
         USING selected WHERE ticket.ticket_hash = selected.ticket_hash`,
      [input.before, limit],
    );
    return {
      commandReceiptsDeleted: receipts.rowCount ?? 0,
      websocketTicketsDeleted: tickets.rowCount ?? 0,
    };
  }

  async historyStorageMetrics(): Promise<HistoryStorageMetrics> {
    const result = await this.pool.query<{
      completed_matches: number | string;
      replay_events: number | string;
      command_receipts: number | string;
      estimated_history_bytes: number | string;
    }>(`SELECT
      (SELECT COUNT(*) FROM match_history) AS completed_matches,
      (SELECT COUNT(*) FROM match_history_events) AS replay_events,
      (SELECT COUNT(*) FROM authoritative_command_receipts) AS command_receipts,
      pg_total_relation_size('match_history') + pg_total_relation_size('match_history_events') AS estimated_history_bytes`);
    const row = result.rows[0]!;
    return {
      completedMatches: integer(row.completed_matches),
      replayEvents: integer(row.replay_events),
      commandReceipts: integer(row.command_receipts),
      estimatedHistoryBytes: integer(row.estimated_history_bytes),
    };
  }
}
