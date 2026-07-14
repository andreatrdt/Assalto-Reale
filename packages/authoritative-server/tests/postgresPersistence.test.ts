import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import type { ServerEventEnvelope } from "@assalto-reale/multiplayer-protocol";
import {
  CommandHandler,
  AccountIdentityConflictError,
  CommandAlreadyProcessedError,
  ConcurrencyConflictError,
  ReceiptConflictError,
  createPostgresPersistence,
  runPostgresMigrations,
  type StoredCommandReceipt,
} from "../src/index.js";
import { createMatchAggregate } from "../src/domain/matchAggregate.js";
import { POSTGRES_MIGRATIONS } from "../src/persistence/postgres/migrations.js";
import {
  ALICE,
  BOB,
  FixedClock,
  ONLINE_CONFIG,
  SequentialIds,
  SequentialSeeds,
  TrustingAuthenticator,
  message,
} from "./support.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

function firstEvent(
  envelopes: ServerEventEnvelope[],
): ServerEventEnvelope["event"] {
  const first = envelopes[0];
  if (!first) throw new Error("Expected at least one server event.");
  return first.event;
}

function makeHandler(pool: Pool): CommandHandler {
  const persistence = createPostgresPersistence(pool);
  return new CommandHandler({
    matches: persistence.matches,
    unitOfWork: persistence.unitOfWork,
    authenticator: new TrustingAuthenticator(),
    clock: new FixedClock(),
    ids: new SequentialIds(),
    seeds: new SequentialSeeds(),
  });
}

function emptyReceipt(
  commandId: string,
  payloadHash = `hash_${commandId}`,
): StoredCommandReceipt {
  return {
    commandId,
    playerId: ALICE,
    matchId: null,
    payloadHash,
    envelopes: [],
  };
}

describe("post-game persistence migration contract", () => {
  it("adds durable presence and safely backfills legacy completions as absent", () => {
    const migration = POSTGRES_MIGRATIONS.find(
      (candidate) => candidate.name === "add_durable_post_game_presence",
    );

    expect(migration?.version).toBe(4);
    expect(migration?.sql).toContain("ADD COLUMN post_game_presence JSONB");
    expect(migration?.sql).toContain("WHERE status = 'ended'");
    expect(migration?.sql).toContain("'presence', 'absent'");
  });
});

describe("immutable history migration contract", () => {
  it("stores compact replay events, immutable summaries, lineage and derived statistics", () => {
    const migration = POSTGRES_MIGRATIONS.find(
      (candidate) => candidate.name === "add_immutable_match_history",
    );

    expect(migration?.version).toBe(5);
    expect(migration?.sql).toContain("CREATE TABLE match_history_events");
    expect(migration?.sql).toContain("CREATE TABLE match_history (");
    expect(migration?.sql).toContain("CREATE TABLE match_history_successors");
    expect(migration?.sql).toContain("CREATE TABLE player_statistics");
    expect(migration?.sql).toContain("match_history_no_update_or_delete");
    expect(migration?.sql).toContain(
      "match_history_events_no_update_or_delete",
    );
    expect(migration?.sql).toContain("replay_available");
    expect(migration?.sql).toContain(
      "history_capture_started_at_version INTEGER",
    );
    expect(migration?.sql).toContain("replay_available, seed");
    expect(migration?.sql).toContain("FALSE,");
    expect(migration?.sql).toContain("WHERE match.status = 'ended'");
  });
});

describe("optional Transform history migration contract", () => {
  it("adds activation and decline event types without rewriting history", () => {
    const migration = POSTGRES_MIGRATIONS.find(
      (candidate) => candidate.name === "add_optional_transform_history_events",
    );

    expect(migration?.version).toBe(6);
    expect(migration?.sql).toContain(
      "DROP CONSTRAINT match_history_events_event_type_check",
    );
    expect(migration?.sql).toContain("'activate_transform'");
    expect(migration?.sql).toContain("'decline_transform'");
    expect(migration?.sql).not.toContain("UPDATE match_history");
  });
});

describePostgres("PostgreSQL authoritative persistence (C.8.2)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await runPostgresMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE account_users, player_identities, authoritative_matches, authoritative_command_receipts CASCADE",
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("applies migrations idempotently and detects edited applied migrations", async () => {
    await runPostgresMigrations(pool);
    const applied = await pool.query<{
      version: number;
      name: string;
      checksum: string;
    }>(
      "SELECT version, name, checksum FROM authoritative_schema_migrations ORDER BY version",
    );
    expect(applied.rows.map((row) => row.name)).toEqual(
      POSTGRES_MIGRATIONS.map((migration) => migration.name),
    );
    expect(applied.rows[0]?.name).toBe("create_authoritative_match_tables");

    const originalChecksum = applied.rows[0]!.checksum;
    await pool.query(
      "UPDATE authoritative_schema_migrations SET checksum = 'edited' WHERE version = 1",
    );
    await expect(runPostgresMigrations(pool)).rejects.toThrow(
      "no longer matches the applied checksum",
    );
    await pool.query(
      "UPDATE authoritative_schema_migrations SET checksum = $1 WHERE version = 1",
      [originalChecksum],
    );
  });

  it("migrates and backfills a current-production v2 schema", async () => {
    const schema = "account_foundation_migration_test";
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.query(`CREATE SCHEMA ${schema}`);
    const legacy = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema}`,
    });
    try {
      await legacy.query(POSTGRES_MIGRATIONS[0]!.sql);
      await legacy.query(POSTGRES_MIGRATIONS[1]!.sql);
      await legacy.query(`
        CREATE TABLE authoritative_schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      for (const migration of POSTGRES_MIGRATIONS.slice(0, 2)) {
        await legacy.query(
          "INSERT INTO authoritative_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
          [
            migration.version,
            migration.name,
            createHash("sha256").update(migration.sql).digest("hex"),
          ],
        );
      }
      await legacy.query(`
        INSERT INTO authoritative_matches (
          match_id, invite_code, version, stream_sequence, seed, config,
          black_player_id, white_player_id, status, state
        ) VALUES (
          'match_legacy01', 'LEGACY01', 2, 2, 42, '{}'::jsonb,
          'player_legacy_black', 'player_legacy_white', 'active', '{}'::jsonb
        )
      `);
      await runPostgresMigrations(legacy);
      const backfill = await legacy.query<{
        players: number;
        memberships: number;
      }>(`
        SELECT
          (SELECT COUNT(*)::int FROM player_identities) AS players,
          (SELECT COUNT(*)::int FROM match_memberships) AS memberships
      `);
      expect(backfill.rows[0]).toEqual({ players: 2, memberships: 2 });
    } finally {
      await legacy.end();
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  });

  it("round-trips a canonical match and invitation lookup", async () => {
    const handler = makeHandler(pool);
    const created = await handler.handle(
      message(
        { type: "CreateMatch", config: ONLINE_CONFIG },
        { commandId: "cmd_pg_create01", playerId: ALICE },
      ),
    );
    const first = created[0];
    if (!first?.matchId || first.event.type !== "MatchCreated") {
      throw new Error("Expected MatchCreated.");
    }

    const persistence = createPostgresPersistence(pool);
    const loaded = await persistence.matches.load(first.matchId);
    const invited = await persistence.matches.findByInviteCode(
      first.event.inviteCode,
    );
    expect(loaded).toEqual(invited);
    expect(loaded?.members.Black).toBe(ALICE);
    expect(loaded?.version).toBe(1);
    expect(loaded?.state.phase).toBe("playing");
    expect(await persistence.matches.load("match_missing01")).toBeNull();
    expect(await persistence.matches.findByInviteCode("MISSING1")).toBeNull();
  });

  it("provisions one durable user under concurrent provider registration", async () => {
    const accounts = createPostgresPersistence(pool).accounts;
    const claims = {
      issuer: "https://tenant.example/",
      providerSubject: "auth0|account-one",
      providerSessionId: "provider-session-one",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      verifiedEmail: "player@example.test",
    };
    const [first, second] = await Promise.all([
      accounts.provisionRegisteredSession(claims),
      accounts.provisionRegisteredSession(claims),
    ]);
    expect(second.user.userId).toBe(first.user.userId);
    expect(second.playerIdentity.playerId).toBe(first.playerIdentity.playerId);
    expect(second.session.sessionId).toBe(first.session.sessionId);
    const counts = await pool.query<{
      users: number;
      identities: number;
      players: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM account_users) AS users,
        (SELECT COUNT(*)::int FROM account_auth_identities) AS identities,
        (SELECT COUNT(*)::int FROM player_identities) AS players
    `);
    expect(counts.rows[0]).toEqual({ users: 1, identities: 1, players: 1 });
  });

  it("rolls back every account row when session creation fails", async () => {
    const accounts = createPostgresPersistence(pool).accounts;
    await expect(
      accounts.provisionRegisteredSession({
        issuer: "https://tenant.example/",
        providerSubject: "auth0|rollback",
        providerSessionId: "provider-session-rollback",
        expiresAt: new Date(Number.NaN),
        verifiedEmail: null,
      }),
    ).rejects.toThrow();
    const counts = await pool.query<{
      users: number;
      identities: number;
      players: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM account_users) AS users,
        (SELECT COUNT(*)::int FROM account_auth_identities) AS identities,
        (SELECT COUNT(*)::int FROM player_identities) AS players
    `);
    expect(counts.rows[0]).toEqual({ users: 0, identities: 0, players: 0 });
  });

  it("enforces session expiry, revocation, guest linkage and one-time tickets", async () => {
    const accounts = createPostgresPersistence(pool).accounts;
    const first = await accounts.provisionRegisteredSession({
      issuer: "https://tenant.example/",
      providerSubject: "auth0|first",
      providerSessionId: "provider-session-first",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      verifiedEmail: null,
    });
    const second = await accounts.provisionRegisteredSession({
      issuer: "https://tenant.example/",
      providerSubject: "auth0|second",
      providerSessionId: "provider-session-second",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      verifiedEmail: null,
    });
    await accounts.ensureGuestIdentity(ALICE);
    const linked = await accounts.claimGuestIdentity(
      first.session.sessionId,
      ALICE,
    );
    expect(linked.playerIdentity).toMatchObject({
      playerId: ALICE,
      userId: first.user.userId,
      kind: "guest",
    });
    await expect(
      accounts.claimGuestIdentity(first.session.sessionId, ALICE),
    ).resolves.toMatchObject({
      playerIdentity: { playerId: ALICE },
    });
    await expect(
      accounts.claimGuestIdentity(second.session.sessionId, ALICE),
    ).rejects.toBeInstanceOf(AccountIdentityConflictError);
    await expect(accounts.isGuestAuthenticationAllowed(ALICE)).resolves.toBe(
      false,
    );

    await accounts.saveWebsocketTicket({
      ticketHash: "ticket-hash-one",
      sessionId: first.session.sessionId,
      playerId: ALICE,
      expiresAt: new Date("2029-01-01T00:00:00.000Z"),
    });
    const consumed = await Promise.all([
      accounts.consumeWebsocketTicket(
        "ticket-hash-one",
        new Date("2028-01-01T00:00:00.000Z"),
      ),
      accounts.consumeWebsocketTicket(
        "ticket-hash-one",
        new Date("2028-01-01T00:00:00.000Z"),
      ),
    ]);
    expect(consumed.filter(Boolean)).toHaveLength(1);
    expect(consumed.find(Boolean)).toEqual({
      playerId: ALICE,
      sessionId: first.session.sessionId,
    });

    expect(
      await accounts.loadSession(
        first.session.sessionId,
        new Date("2031-01-01T00:00:00.000Z"),
      ),
    ).toBeNull();
    expect(
      await accounts.revokeSession(
        second.session.sessionId,
        new Date("2028-01-01T00:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      await accounts.loadSession(
        second.session.sessionId,
        new Date("2028-01-02T00:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("dual-writes normalized memberships and exposes linked active matches", async () => {
    const handler = makeHandler(pool);
    const created = await handler.handle(
      message(
        { type: "CreateMatch", config: ONLINE_CONFIG },
        { commandId: "cmd_account_match", playerId: ALICE },
      ),
    );
    const matchId = created[0]?.matchId;
    if (!matchId) throw new Error("Expected a created match.");
    const accounts = createPostgresPersistence(pool).accounts;
    const session = await accounts.provisionRegisteredSession({
      issuer: "https://tenant.example/",
      providerSubject: "auth0|membership",
      providerSessionId: "provider-session-membership",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      verifiedEmail: null,
    });
    await accounts.claimGuestIdentity(session.session.sessionId, ALICE);
    await expect(
      accounts.resolveMatchPlayer(session.user.userId, matchId),
    ).resolves.toBe(ALICE);
    await expect(
      accounts.listActiveMatches(session.user.userId),
    ).resolves.toMatchObject([
      { matchId, playerId: ALICE, side: "Black", status: "awaitingOpponent" },
    ]);
  });

  it("persists JoinMatch and its command receipt atomically", async () => {
    const handler = makeHandler(pool);
    const created = await handler.handle(
      message(
        { type: "CreateMatch", config: ONLINE_CONFIG },
        { commandId: "cmd_pg_join001", playerId: ALICE },
      ),
    );
    const first = created[0];
    if (!first?.matchId || first.event.type !== "MatchCreated") {
      throw new Error("Expected MatchCreated.");
    }

    const joined = await handler.handle(
      message(
        { type: "JoinMatch", inviteCode: first.event.inviteCode },
        {
          commandId: "cmd_pg_join002",
          playerId: BOB,
          matchId: first.matchId,
        },
      ),
    );
    expect(firstEvent(joined).type).toBe("PlayerJoined");

    const persistence = createPostgresPersistence(pool);
    const loaded = await persistence.matches.load(first.matchId);
    expect(loaded?.members.White).toBe(BOB);
    expect(loaded?.status).toBe("active");
    expect(loaded?.version).toBe(2);

    const counts = await pool.query<{
      matches: number;
      receipts: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM authoritative_matches) AS matches,
        (SELECT COUNT(*)::int FROM authoritative_command_receipts) AS receipts
    `);
    expect(counts.rows[0]).toEqual({ matches: 1, receipts: 2 });
  });

  it("finalizes immutable history exactly once and attaches guest history on account claim", async () => {
    const handler = makeHandler(pool);
    const created = await handler.handle(
      message(
        { type: "CreateMatch", config: ONLINE_CONFIG },
        { commandId: "cmd_pg_history_create", playerId: ALICE },
      ),
    );
    const first = created[0];
    if (!first?.matchId || first.event.type !== "MatchCreated")
      throw new Error("Expected MatchCreated.");
    await handler.handle(
      message(
        { type: "JoinMatch", inviteCode: first.event.inviteCode },
        {
          commandId: "cmd_pg_history_join",
          playerId: BOB,
          matchId: first.matchId,
        },
      ),
    );
    const terminal = message(
      { type: "Resign" },
      {
        commandId: "cmd_pg_history_resign",
        playerId: BOB,
        matchId: first.matchId,
        expectedMatchVersion: 2,
      },
    );
    const completed = await handler.handle(terminal);
    await expect(handler.handle(terminal)).resolves.toEqual(completed);

    const beforeClaim = await pool.query<{
      histories: number;
      events: number;
      statistics: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM match_history) AS histories,
        (SELECT COUNT(*)::int FROM match_history_events) AS events,
        (SELECT COUNT(*)::int FROM player_statistics) AS statistics
    `);
    expect(beforeClaim.rows[0]).toEqual({
      histories: 1,
      events: 1,
      statistics: 0,
    });

    const persistence = createPostgresPersistence(pool);
    const account = await persistence.accounts.provisionRegisteredSession({
      issuer: "https://tenant.example/",
      providerSubject: "auth0|history-owner",
      providerSessionId: "provider-session-history-owner",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      verifiedEmail: null,
    });
    await persistence.accounts.claimGuestIdentity(
      account.session.sessionId,
      ALICE,
    );
    await persistence.accounts.claimGuestIdentity(
      account.session.sessionId,
      ALICE,
    );

    await expect(
      persistence.history.listForUser(account.user.userId, { limit: 10 }),
    ).resolves.toMatchObject({
      matches: [
        { matchId: first.matchId, result: "win", replayAvailable: true },
      ],
      nextCursor: null,
    });
    await expect(
      persistence.history.statisticsForUser(account.user.userId),
    ).resolves.toMatchObject({
      gamesPlayed: 1,
      wins: 1,
      resignationWins: 1,
    });
    await expect(
      pool.query("UPDATE match_history SET total_turns = total_turns + 1"),
    ).rejects.toThrow("completed match history is immutable");

    const cleanup = await persistence.maintenance.cleanupTransientRecords({
      before: new Date("2100-01-01T00:00:00.000Z"),
      limit: 100,
    });
    expect(cleanup.commandReceiptsDeleted).toBeGreaterThan(0);
    const restarted = createPostgresPersistence(pool);
    await expect(
      restarted.history.getForUser(account.user.userId, first.matchId),
    ).resolves.toMatchObject({
      matchId: first.matchId,
      replayAvailable: true,
      events: [{ sequenceNumber: 1, eventType: "resignation" }],
    });
    await expect(
      pool.query("SELECT COUNT(*)::int AS count FROM match_history"),
    ).resolves.toMatchObject({
      rows: [{ count: 1 }],
    });
  });

  it("round-trips durable post-game presence without changing completed state", async () => {
    const persistence = createPostgresPersistence(pool);
    const active = createMatchAggregate({
      matchId: "match_postgame_pg",
      inviteCode: "POSTGAME",
      seed: 77,
      config: ONLINE_CONFIG,
      creatorPlayerId: ALICE,
    }).aggregate;
    const completed = {
      ...active,
      status: "ended" as const,
      endReason: "resignation" as const,
      members: { Black: ALICE, White: BOB },
      postGame: {
        Black: { presence: "present" as const, graceExpiresAt: null },
        White: {
          presence: "grace" as const,
          graceExpiresAt: "2026-01-01T00:00:30.000Z",
        },
      },
    };
    await persistence.unitOfWork.run(async (tx) => {
      tx.saveMatch(completed, { kind: "create" });
    });

    const loaded = await persistence.matches.load(completed.matchId);
    expect(loaded?.status).toBe("ended");
    expect(loaded?.endReason).toBe("resignation");
    expect(loaded?.state).toEqual(completed.state);
    expect(loaded?.postGame).toEqual(completed.postGame);
  });

  it("replays one canonical result when exact CreateMatch retries race", async () => {
    const handler = makeHandler(pool);
    const command = message(
      { type: "CreateMatch", config: ONLINE_CONFIG },
      { commandId: "cmd_pg_race0001", playerId: ALICE },
    );

    const [first, second] = await Promise.all([
      handler.handle(command),
      handler.handle(command),
    ]);
    expect(second).toEqual(first);

    const counts = await pool.query<{
      matches: number;
      receipts: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM authoritative_matches) AS matches,
        (SELECT COUNT(*)::int FROM authoritative_command_receipts) AS receipts
    `);
    expect(counts.rows[0]).toEqual({ matches: 1, receipts: 1 });
  });

  it("rejects commandId reuse with a different semantic payload", async () => {
    const handler = makeHandler(pool);
    await handler.handle(
      message(
        { type: "CreateMatch", config: ONLINE_CONFIG },
        { commandId: "cmd_pg_duplicate", playerId: ALICE },
      ),
    );
    const duplicate = await handler.handle(
      message(
        {
          type: "CreateMatch",
          config: { ...ONLINE_CONFIG, transformEnabled: true },
        },
        { commandId: "cmd_pg_duplicate", playerId: ALICE },
      ),
    );
    const event = firstEvent(duplicate);
    expect(event.type).toBe("CommandRejected");
    if (event.type === "CommandRejected") {
      expect(event.code).toBe("duplicate_command");
    }
  });

  it("rolls back both receipt and matches when a later staged write fails", async () => {
    const persistence = createPostgresPersistence(pool);
    const first = createMatchAggregate({
      matchId: "match_atomic01",
      inviteCode: "ATOMIC01",
      seed: 101,
      config: ONLINE_CONFIG,
      creatorPlayerId: ALICE,
    }).aggregate;
    const second = createMatchAggregate({
      matchId: "match_atomic02",
      inviteCode: "ATOMIC01",
      seed: 102,
      config: ONLINE_CONFIG,
      creatorPlayerId: BOB,
    }).aggregate;

    await expect(
      persistence.unitOfWork.run(async (tx) => {
        tx.saveReceipt(emptyReceipt("cmd_pg_atomic01"));
        tx.saveMatch(first, { kind: "create" });
        tx.saveMatch(second, { kind: "create" });
      }),
    ).rejects.toBeInstanceOf(ConcurrencyConflictError);

    const counts = await pool.query<{
      matches: number;
      receipts: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM authoritative_matches) AS matches,
        (SELECT COUNT(*)::int FROM authoritative_command_receipts) AS receipts
    `);
    expect(counts.rows[0]).toEqual({ matches: 0, receipts: 0 });
  });

  it("allows only one transaction to commit against a shared version", async () => {
    const persistence = createPostgresPersistence(pool);
    const initial = createMatchAggregate({
      matchId: "match_version01",
      inviteCode: "VERSION1",
      seed: 201,
      config: ONLINE_CONFIG,
      creatorPlayerId: ALICE,
    }).aggregate;
    await persistence.unitOfWork.run(async (tx) => {
      tx.saveMatch(initial, { kind: "create" });
    });

    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const update = (commandId: string) =>
      persistence.unitOfWork.run(async (tx) => {
        const current = await tx.loadMatch(initial.matchId);
        if (!current) throw new Error("Expected persisted match.");
        arrivals += 1;
        if (arrivals === 2) release();
        await gate;
        tx.saveReceipt(emptyReceipt(commandId));
        tx.saveMatch(
          {
            ...current,
            version: current.version + 1,
            streamSequence: current.streamSequence + 1,
          },
          { kind: "expectedVersion", version: current.version },
        );
      });

    const results = await Promise.allSettled([
      update("cmd_pg_version1"),
      update("cmd_pg_version2"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(ConcurrencyConflictError);
    }

    expect((await persistence.matches.load(initial.matchId))?.version).toBe(2);
    const receipts = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM authoritative_command_receipts",
    );
    expect(receipts.rows[0]?.count).toBe(1);
  });

  it("distinguishes an exact stored receipt from a conflicting reuse", async () => {
    const persistence = createPostgresPersistence(pool);
    const original = emptyReceipt("cmd_pg_receipt1", "same_hash");
    await persistence.unitOfWork.run(async (tx) => {
      tx.saveReceipt(original);
    });

    await expect(
      persistence.unitOfWork.run(async (tx) => {
        tx.saveReceipt(original);
      }),
    ).rejects.toBeInstanceOf(CommandAlreadyProcessedError);

    await expect(
      persistence.unitOfWork.run(async (tx) => {
        tx.saveReceipt(emptyReceipt("cmd_pg_receipt1", "other_hash"));
      }),
    ).rejects.toBeInstanceOf(ReceiptConflictError);
  });

  it("rejects corrupt persisted match state and receipt envelopes", async () => {
    await pool.query(
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
          end_reason
        )
        VALUES ($1, $2, 1, 1, 1, $3::jsonb, $4, NULL, 'awaitingOpponent', '{}'::jsonb, NULL)
      `,
      ["match_corrupt1", "CORRUPT1", JSON.stringify(ONLINE_CONFIG), ALICE],
    );
    const persistence = createPostgresPersistence(pool);
    await expect(persistence.matches.load("match_corrupt1")).rejects.toThrow(
      "Corrupt PostgreSQL match state",
    );

    await pool.query(
      `
        INSERT INTO authoritative_command_receipts (
          command_id,
          player_id,
          match_id,
          payload_hash,
          envelopes
        )
        VALUES ($1, $2, NULL, 'hash', '[{"bad":true}]'::jsonb)
      `,
      ["cmd_pg_corrupt1", ALICE],
    );
    await expect(
      persistence.unitOfWork.run((tx) => tx.findReceipt("cmd_pg_corrupt1")),
    ).rejects.toThrow("Corrupt PostgreSQL command receipt envelope");
  });
});
