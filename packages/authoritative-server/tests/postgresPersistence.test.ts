import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { ServerEventEnvelope } from "@assalto-reale/multiplayer-protocol";
import {
  CommandHandler,
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

describePostgres("PostgreSQL authoritative persistence (C.8.2)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await runPostgresMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE authoritative_command_receipts, authoritative_matches",
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
