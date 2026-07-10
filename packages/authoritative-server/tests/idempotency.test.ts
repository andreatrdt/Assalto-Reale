import { describe, expect, it } from "vitest";
import type {
  ServerEvent,
  ServerEventEnvelope,
} from "@assalto-reale/multiplayer-protocol";
import {
  ALICE,
  BOB,
  ONLINE_CONFIG,
  boardWith,
  harness,
  message,
  playingState,
  seedMatch,
} from "./support.js";

function only<T extends ServerEvent["type"]>(
  envelopes: ServerEventEnvelope[],
  type: T,
): Extract<ServerEvent, { type: T }> {
  const found = envelopes.find((envelope) => envelope.event.type === type);
  if (!found) throw new Error(`Expected ${type}`);
  return found.event as Extract<ServerEvent, { type: T }>;
}

describe("authoritative idempotency and optimistic concurrency", () => {
  it("requires the matching invitation code for the targeted match", async () => {
    const { handler, store } = harness();
    const created = await handler.handle(
      message(
        { type: "CreateMatch", config: ONLINE_CONFIG },
        { commandId: "cmd_invite01", playerId: ALICE },
      ),
    );
    const inviteCode = only(created, "MatchCreated").inviteCode;
    const matchId = created[0]!.matchId!;

    const joined = await handler.handle(
      message(
        { type: "JoinMatch", inviteCode },
        { commandId: "cmd_invite02", playerId: BOB, matchId },
      ),
    );

    expect(only(joined, "PlayerJoined").playerId).toBe(BOB);
    expect([...store.matches.values()][0]?.status).toBe("active");
  });

  it("replays one canonical result when identical commands race", async () => {
    const { handler, store } = harness();
    const command = message(
      { type: "CreateMatch", config: ONLINE_CONFIG },
      { commandId: "cmd_race0001", playerId: ALICE },
    );

    const [first, second] = await Promise.all([
      handler.handle(command),
      handler.handle(command),
    ]);

    expect(second).toEqual(first);
    expect(store.matches.size).toBe(1);
    expect(store.receipts.size).toBe(1);
  });

  it("treats match target and expected version as part of command identity", async () => {
    const { handler, store } = harness();
    seedMatch(
      store,
      playingState(
        boardWith([
          ["Black", "King", [10, 1]],
          ["White", "King", [1, 10]],
        ]),
      ),
    );

    await handler.handle(
      message(
        { type: "PassTurn" },
        {
          commandId: "cmd_scope001",
          playerId: ALICE,
          matchId: "match_seed01",
          expectedMatchVersion: 1,
        },
      ),
    );
    const reused = await handler.handle(
      message(
        { type: "PassTurn" },
        {
          commandId: "cmd_scope001",
          playerId: ALICE,
          matchId: "match_seed01",
          expectedMatchVersion: 2,
        },
      ),
    );

    expect(only(reused, "CommandRejected").code).toBe("duplicate_command");
  });

  it("makes RequestSync retry-safe and replays the exact event envelope", async () => {
    const { handler, store } = harness();
    seedMatch(
      store,
      playingState(
        boardWith([
          ["Black", "King", [10, 1]],
          ["White", "King", [1, 10]],
        ]),
      ),
    );
    const command = message(
      { type: "RequestSync", lastSeenMatchVersion: null },
      { commandId: "cmd_syncdup1", playerId: ALICE, matchId: "match_seed01" },
    );

    const first = await handler.handle(command);
    const second = await handler.handle(command);

    expect(second).toEqual(first);
    expect(first[0]?.event.type).toBe("MatchSnapshot");
    expect(store.receipts.has("cmd_syncdup1")).toBe(true);
  });

  it("allows only one of two commands against the same version to commit", async () => {
    const { handler, store } = harness();
    seedMatch(
      store,
      playingState(
        boardWith([
          ["Black", "King", [10, 1]],
          ["White", "King", [1, 10]],
        ]),
      ),
    );

    const [first, second] = await Promise.all([
      handler.handle(
        message(
          { type: "PassTurn" },
          {
            commandId: "cmd_concur01",
            playerId: ALICE,
            matchId: "match_seed01",
            expectedMatchVersion: 1,
          },
        ),
      ),
      handler.handle(
        message(
          { type: "PassTurn" },
          {
            commandId: "cmd_concur02",
            playerId: ALICE,
            matchId: "match_seed01",
            expectedMatchVersion: 1,
          },
        ),
      ),
    ]);

    const all = [...first, ...second];
    expect(all.some((envelope) => envelope.event.type === "MatchUpdated")).toBe(
      true,
    );
    expect(
      all.some(
        (envelope) =>
          envelope.event.type === "CommandRejected" &&
          envelope.event.code === "stale_match_version",
      ),
    ).toBe(true);
    expect(store.matches.get("match_seed01")?.version).toBe(2);
  });

  it("addresses authenticated rejections only to the issuing player", async () => {
    const { handler, store } = harness();
    seedMatch(
      store,
      playingState(
        boardWith([
          ["Black", "King", [10, 1]],
          ["White", "King", [1, 10]],
        ]),
      ),
    );

    const rejected = await handler.handle(
      message(
        { type: "PassTurn" },
        {
          commandId: "cmd_recip001",
          playerId: BOB,
          matchId: "match_seed01",
          expectedMatchVersion: 1,
        },
      ),
    );

    expect(only(rejected, "CommandRejected").code).toBe("not_your_turn");
    expect(rejected[0]?.recipient).toEqual({ playerId: BOB });
  });
});
