import { describe, expect, it } from "vitest";
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
