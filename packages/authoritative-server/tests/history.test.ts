import { describe, expect, it } from "vitest";
import { applyGameCommand } from "../src/domain/matchAggregate.js";
import { createStoredHistoryEvent } from "../src/history.js";
import { ALICE, BOB, ONLINE_CONFIG, harness, message } from "./support.js";

async function createJoinedMatch() {
  const test = harness();
  test.store.userByPlayer.set(ALICE, "user_alice");
  test.store.userByPlayer.set(BOB, "user_bob");
  const created = await test.handler.handle(
    message(
      { type: "CreateMatch", config: ONLINE_CONFIG },
      { commandId: "cmd_history_create", playerId: ALICE },
    ),
  );
  const matchId = created[0]!.matchId!;
  const inviteCode = test.store.matches.get(matchId)!.inviteCode;
  await test.handler.handle(
    message(
      { type: "JoinMatch", inviteCode },
      { commandId: "cmd_history_join", playerId: BOB, matchId },
    ),
  );
  return { ...test, matchId };
}

describe("immutable match history", () => {
  it("keeps an out-of-turn resignation replayable", async () => {
    const test = await createJoinedMatch();
    expect(
      test.store.matches.get(test.matchId)?.historyCaptureStartedAtVersion,
    ).toBe(1);
    await test.handler.handle(
      message(
        { type: "Resign" },
        {
          commandId: "cmd_history_out_of_turn_resign",
          playerId: BOB,
          matchId: test.matchId,
          expectedMatchVersion: 2,
        },
      ),
    );

    expect(test.store.histories.get(test.matchId)).toMatchObject({
      winnerSide: "Black",
      replayAvailable: true,
      totalEvents: 1,
    });
  });

  it("compares PostgreSQL JSONB-reordered snapshots by complete semantic state", async () => {
    const test = await createJoinedMatch();
    const aggregate = test.store.matches.get(test.matchId)!;
    const position = aggregate.state.board.grid
      .flatMap((row, rowIndex) =>
        row.map((piece, columnIndex) => ({ piece, rowIndex, columnIndex })),
      )
      .find(({ piece }) => piece !== null)!;
    const piece = position.piece!;
    // PostgreSQL JSONB emits the shorter `type` key before `player`. Recreate
    // that semantically irrelevant property order without changing game state.
    aggregate.state.board.grid[position.rowIndex]![position.columnIndex] = {
      type: piece.type,
      player: piece.player,
    };

    await test.handler.handle(
      message(
        { type: "Resign" },
        {
          commandId: "cmd_history_jsonb_order_resign",
          playerId: BOB,
          matchId: test.matchId,
          expectedMatchVersion: 2,
        },
      ),
    );

    expect(test.store.histories.get(test.matchId)).toMatchObject({
      replayAvailable: true,
      totalEvents: 1,
    });
  });

  it("fails finalization when a newly captured replay has an event-count gap", async () => {
    const test = await createJoinedMatch();
    test.store.matches.get(test.matchId)!.historyEventSequence = 1;

    await expect(
      test.handler.handle(
        message(
          { type: "Resign" },
          {
            commandId: "cmd_history_sequence_gap",
            playerId: BOB,
            matchId: test.matchId,
            expectedMatchVersion: 2,
          },
        ),
      ),
    ).rejects.toThrow("Captured replay event count mismatch");
    expect(test.store.histories.has(test.matchId)).toBe(false);
  });

  it("rolls back a fully captured state mismatch and permits one corrected retry", async () => {
    const test = await createJoinedMatch();
    const aggregate = test.store.matches.get(test.matchId)!;
    aggregate.state.movesThisTurn = 1;
    const terminal = message(
      { type: "Resign" },
      {
        commandId: "cmd_history_state_mismatch",
        playerId: BOB,
        matchId: test.matchId,
        expectedMatchVersion: 2,
      },
    );

    await expect(test.handler.handle(terminal)).rejects.toThrow(
      "Captured replay final state mismatch",
    );
    expect(test.store.matches.get(test.matchId)).toMatchObject({
      status: "active",
      version: 2,
      historyEventSequence: 0,
    });
    expect(test.store.historyEvents.has(test.matchId)).toBe(false);
    expect(test.store.histories.has(test.matchId)).toBe(false);
    expect(test.store.statistics.size).toBe(0);
    expect(test.store.receipts.has("cmd_history_state_mismatch")).toBe(false);

    test.store.matches.get(test.matchId)!.state.movesThisTurn = 0;
    await expect(test.handler.handle(terminal)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({ type: "MatchEnded" }),
        }),
      ]),
    );
    expect(test.store.histories.size).toBe(1);
    expect(test.store.historyEvents.get(test.matchId)).toHaveLength(1);
    expect(test.store.statistics.get("user_alice")?.gamesPlayed).toBe(1);
    expect(test.store.statistics.get("user_bob")?.gamesPlayed).toBe(1);
  });

  it("succeeds exactly once when a missing accepted event is repaired before retry", async () => {
    const test = await createJoinedMatch();
    const previous = test.store.matches.get(test.matchId)!;
    const progressed = applyGameCommand(previous, "Black", {
      type: "PassTurn",
    });
    if (!progressed.ok) throw new Error(progressed.message);
    // Model a persistence fault in which the authoritative transition survived
    // but its ordered replay event did not. Finalization must fail atomically.
    test.store.matches.set(test.matchId, progressed.aggregate);
    const terminal = message(
      { type: "Resign" },
      {
        commandId: "cmd_history_repaired_stream",
        playerId: BOB,
        matchId: test.matchId,
        expectedMatchVersion: 3,
      },
    );

    await expect(test.handler.handle(terminal)).rejects.toThrow(
      "Captured replay event count mismatch",
    );
    expect(test.store.histories.has(test.matchId)).toBe(false);
    expect(test.store.statistics.size).toBe(0);
    expect(test.store.receipts.has("cmd_history_repaired_stream")).toBe(false);

    test.store.historyEvents.set(test.matchId, [
      createStoredHistoryEvent({
        previous,
        next: progressed.aggregate,
        actorPlayerId: ALICE,
        actorSide: "Black",
        command: { type: "PassTurn" },
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ]);
    const completed = await test.handler.handle(terminal);
    await expect(test.handler.handle(terminal)).resolves.toEqual(completed);
    expect(test.store.histories.size).toBe(1);
    expect(test.store.historyEvents.get(test.matchId)).toHaveLength(2);
    expect(test.store.statistics.get("user_alice")?.gamesPlayed).toBe(1);
    expect(test.store.statistics.get("user_bob")?.gamesPlayed).toBe(1);
  });

  it("finalizes compact replay and player statistics exactly once with the terminal command", async () => {
    const test = await createJoinedMatch();
    await test.handler.handle(
      message(
        { type: "PassTurn" },
        {
          commandId: "cmd_history_pass",
          playerId: ALICE,
          matchId: test.matchId,
          expectedMatchVersion: 2,
        },
      ),
    );
    const terminal = message(
      { type: "Resign" },
      {
        commandId: "cmd_history_resign",
        playerId: BOB,
        matchId: test.matchId,
        expectedMatchVersion: 3,
      },
    );
    const first = await test.handler.handle(terminal);
    const retry = await test.handler.handle(terminal);

    expect(first.at(-1)?.event).toMatchObject({ type: "MatchEnded" });
    expect(retry).toEqual(first);
    expect(test.store.histories.size).toBe(1);
    const history = test.store.histories.get(test.matchId)!;
    expect(history).toMatchObject({
      matchId: test.matchId,
      winnerSide: "Black",
      result: "Black",
      victoryReason: "resignation",
      totalEvents: 2,
      replayAvailable: true,
      blackUserId: "user_alice",
      whiteUserId: "user_bob",
    });
    expect(history.finalSnapshot).toBeDefined();
    expect(history.integrityChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(test.store.historyEvents.get(test.matchId)).toEqual([
      expect.objectContaining({
        sequenceNumber: 1,
        eventType: "pass_turn",
        matchVersionBefore: 2,
        matchVersionAfter: 3,
      }),
      expect.objectContaining({
        sequenceNumber: 2,
        eventType: "resignation",
        matchVersionBefore: 3,
        matchVersionAfter: 4,
      }),
    ]);
    const payload = test.store.historyEvents.get(test.matchId)![0]!
      .payload as unknown as Record<string, unknown>;
    expect(payload).not.toHaveProperty("snapshot");
    expect(payload).not.toHaveProperty("history");
    expect(test.store.statistics.get("user_alice")).toMatchObject({
      gamesPlayed: 1,
      wins: 1,
      resignationWins: 1,
    });
    expect(test.store.statistics.get("user_bob")).toMatchObject({
      gamesPlayed: 1,
      losses: 1,
    });
  });

  it("keeps the immutable result unchanged through departure and appends rematch lineage separately", async () => {
    const test = await createJoinedMatch();
    await test.handler.handle(
      message(
        { type: "Resign" },
        {
          commandId: "cmd_lineage_resign",
          playerId: ALICE,
          matchId: test.matchId,
          expectedMatchVersion: 2,
        },
      ),
    );
    const checksum = test.store.histories.get(test.matchId)!.integrityChecksum;
    await test.handler.handle(
      message(
        { type: "LeavePostGame" },
        {
          commandId: "cmd_lineage_leave",
          playerId: ALICE,
          matchId: test.matchId,
        },
      ),
    );
    expect(test.store.histories.get(test.matchId)!.integrityChecksum).toBe(
      checksum,
    );

    // Re-entry permits a fresh negotiation but can never mutate the old result.
    await test.handler.handle(
      message(
        { type: "RequestSync", lastSeenMatchVersion: null },
        {
          commandId: "cmd_lineage_reenter",
          playerId: ALICE,
          matchId: test.matchId,
        },
      ),
    );
    await test.handler.handle(
      message(
        { type: "OfferRematch" },
        {
          commandId: "cmd_lineage_offer_a",
          playerId: ALICE,
          matchId: test.matchId,
        },
      ),
    );
    await test.handler.handle(
      message(
        { type: "RespondToRematch", accept: true },
        {
          commandId: "cmd_lineage_accept_b",
          playerId: BOB,
          matchId: test.matchId,
        },
      ),
    );
    const successor = test.store.matches.get(test.matchId)!.successorMatchId!;
    expect(test.store.historySuccessors.get(test.matchId)).toBe(successor);
    expect(test.store.histories.get(test.matchId)!.integrityChecksum).toBe(
      checksum,
    );
    expect(test.store.histories.has(successor)).toBe(false);

    await test.handler.handle(
      message(
        { type: "Resign" },
        {
          commandId: "cmd_lineage_successor_resign",
          playerId: ALICE,
          matchId: successor,
          expectedMatchVersion: 1,
        },
      ),
    );
    expect(test.store.histories.size).toBe(2);
    expect(test.store.histories.get(successor)).toMatchObject({
      matchId: successor,
      predecessorMatchId: test.matchId,
      replayAvailable: true,
      totalEvents: 1,
    });
    expect(test.store.histories.get(successor)!.integrityChecksum).not.toBe(
      checksum,
    );
    expect(test.store.histories.get(test.matchId)!.integrityChecksum).toBe(
      checksum,
    );
  });

  it("marks a capture that began before replay capture as preserved but not replayable", async () => {
    const test = await createJoinedMatch();
    const aggregate = test.store.matches.get(test.matchId)!;
    aggregate.historyCaptureStartedAtVersion = null;
    await test.handler.handle(
      message(
        { type: "Resign" },
        {
          commandId: "cmd_legacy_resign",
          playerId: ALICE,
          matchId: test.matchId,
          expectedMatchVersion: 2,
        },
      ),
    );
    expect(test.store.histories.get(test.matchId)).toMatchObject({
      replayAvailable: false,
      totalEvents: 1,
    });
  });
});
