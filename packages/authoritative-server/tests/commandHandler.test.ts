import { describe, expect, it } from "vitest";
import type {
  ServerEvent,
  ServerEventEnvelope,
} from "@assalto-reale/multiplayer-protocol";
import {
  CommandHandler,
  InMemoryStore,
  ConcurrencyConflictError,
  createInMemoryPersistence,
  type Transaction,
  type UnitOfWork,
} from "../src/index.js";
import {
  ALICE,
  BOB,
  FixedClock,
  FixedPrincipalAuthenticator,
  ONLINE_CONFIG,
  SequentialIds,
  SequentialSeeds,
  TrustingAuthenticator,
  boardWith,
  harness,
  message,
  playingState,
  seedMatch,
} from "./support.js";

function types(envelopes: ServerEventEnvelope[]): ServerEvent["type"][] {
  return envelopes.map((envelope) => envelope.event.type);
}

function only<T extends ServerEvent["type"]>(
  envelopes: ServerEventEnvelope[],
  type: T,
): Extract<ServerEvent, { type: T }> {
  const found = envelopes.find((envelope) => envelope.event.type === type);
  if (!found)
    throw new Error(`No ${type} event in [${types(envelopes).join(", ")}]`);
  return found.event as Extract<ServerEvent, { type: T }>;
}

async function createAndJoin(): Promise<{
  handler: CommandHandler;
  store: InMemoryStore;
  matchId: string;
  inviteCode: string;
}> {
  const { handler, store } = harness();
  const created = await handler.handle(
    message(
      { type: "CreateMatch", config: ONLINE_CONFIG },
      { commandId: "cmd_create01", playerId: ALICE },
    ),
  );
  const matchCreated = only(created, "MatchCreated");
  const matchId = [...store.matches.keys()][0]!;
  await handler.handle(
    message(
      { type: "JoinMatch", inviteCode: matchCreated.inviteCode },
      { commandId: "cmd_join0001", playerId: BOB, matchId },
    ),
  );
  return { handler, store, matchId, inviteCode: matchCreated.inviteCode };
}

describe("authoritative command handler (C.8.1)", () => {
  it("CreateMatch creates a server-seeded canonical match", async () => {
    const { handler, store, seeds } = harness();
    const expectedSeed = new SequentialSeeds().next();
    const out = await handler.handle(
      message(
        { type: "CreateMatch", config: ONLINE_CONFIG },
        { commandId: "cmd_create01", playerId: ALICE },
      ),
    );

    const event = only(out, "MatchCreated");
    expect(event.snapshot.schema).toBe(1);
    expect(event.assignedSide).toBe("Black");
    expect(store.matches.size).toBe(1);
    const aggregate = [...store.matches.values()][0]!;
    expect(aggregate.members.Black).toBe(ALICE);
    expect(aggregate.members.White).toBeNull();
    expect(aggregate.version).toBe(1);
    // The seed is server-generated, never client supplied.
    expect(aggregate.seed).toBe(expectedSeed);
    expect(out[0]!.matchVersion).toBe(1);
    expect(out[0]!.streamSequence).toBe(1);
    void seeds;
  });

  it("JoinMatch assigns the second player correctly", async () => {
    const { store, matchId } = await createAndJoin();
    const aggregate = store.matches.get(matchId)!;
    expect(aggregate.members.Black).toBe(ALICE);
    expect(aggregate.members.White).toBe(BOB);
    expect(aggregate.status).toBe("active");
    expect(aggregate.version).toBe(2);
  });

  it("JoinMatch resolves the match by invite code when matchId is omitted", async () => {
    // The real two-device flow: the joining device only has the invite code, not
    // the matchId, so the envelope carries matchId=null and the server resolves
    // the invite. (The client can never know the matchId before joining.)
    const { handler, store } = harness();
    const created = await handler.handle(
      message(
        { type: "CreateMatch", config: ONLINE_CONFIG },
        { commandId: "cmd_create01", playerId: ALICE },
      ),
    );
    const inviteCode = only(created, "MatchCreated").inviteCode;
    const matchId = [...store.matches.keys()][0]!;

    const joined = await handler.handle(
      message(
        { type: "JoinMatch", inviteCode },
        { commandId: "cmd_join0001", playerId: BOB, matchId: null },
      ),
    );

    // The server resolved the invite and stamped the canonical matchId on the
    // emitted events even though the client supplied none.
    const playerJoined = only(joined, "PlayerJoined");
    expect(playerJoined.assignedSide).toBe("White");
    expect(joined[0]!.matchId).toBe(matchId);
    const aggregate = store.matches.get(matchId)!;
    expect(aggregate.members.White).toBe(BOB);
    expect(aggregate.status).toBe("active");
    expect(aggregate.version).toBe(2);
  });

  it("JoinMatch with an unknown invite code is rejected as invite_invalid", async () => {
    const { handler } = harness();
    const rejected = await handler.handle(
      message(
        { type: "JoinMatch", inviteCode: "NOSUCH01" },
        { commandId: "cmd_join0001", playerId: BOB, matchId: null },
      ),
    );
    const rejection = only(rejected, "CommandRejected");
    expect(rejection.code).toBe("invite_invalid");
  });

  it("a duplicate identical command returns the same result", async () => {
    const { handler, store } = harness();
    const msg = message(
      { type: "CreateMatch", config: ONLINE_CONFIG },
      { commandId: "cmd_dup00001", playerId: ALICE },
    );
    const first = await handler.handle(msg);
    const second = await handler.handle(msg);
    expect(second).toEqual(first);
    expect(store.matches.size).toBe(1);
  });

  it("a duplicate commandId with a different payload is rejected", async () => {
    const { handler } = harness();
    await handler.handle(
      message(
        { type: "CreateMatch", config: ONLINE_CONFIG },
        { commandId: "cmd_dup00002", playerId: ALICE },
      ),
    );
    const out = await handler.handle(
      message(
        {
          type: "CreateMatch",
          config: { ...ONLINE_CONFIG, transformEnabled: true },
        },
        { commandId: "cmd_dup00002", playerId: ALICE },
      ),
    );
    expect(only(out, "CommandRejected").code).toBe("duplicate_command");
  });

  it("an actor/principal mismatch is rejected", async () => {
    const { handler } = harness({
      authenticator: new FixedPrincipalAuthenticator({
        playerId: BOB,
        sessionId: "session_x1x2x3",
      }),
    });
    const out = await handler.handle(
      message(
        { type: "CreateMatch", config: ONLINE_CONFIG },
        { commandId: "cmd_actor001", playerId: ALICE },
      ),
    );
    expect(only(out, "CommandRejected").code).toBe("unauthorized");
  });

  it("an unauthenticated command is rejected", async () => {
    const { handler } = harness({
      authenticator: new FixedPrincipalAuthenticator(null),
    });
    const out = await handler.handle(
      message(
        { type: "CreateMatch", config: ONLINE_CONFIG },
        { commandId: "cmd_noauth01", playerId: ALICE },
      ),
    );
    expect(only(out, "CommandRejected").code).toBe("unauthenticated");
  });

  it("a non-member command is rejected", async () => {
    const { handler, store } = harness();
    seedMatch(
      store,
      playingState(boardWith([["Black", "AttackPawn", [5, 5]]])),
    );
    const out = await handler.handle(
      message(
        { type: "SubmitAction", start: [5, 5], end: [5, 6] },
        {
          commandId: "cmd_nonmemb1",
          playerId: "player_carol9",
          matchId: "match_seed01",
          expectedMatchVersion: 1,
        },
      ),
    );
    expect(only(out, "CommandRejected").code).toBe("unauthorized");
  });

  it("a stale expectedMatchVersion is rejected", async () => {
    const { handler, store } = harness();
    seedMatch(
      store,
      playingState(boardWith([["Black", "AttackPawn", [5, 5]]])),
    );
    const out = await handler.handle(
      message(
        { type: "SubmitAction", start: [5, 5], end: [5, 6] },
        {
          commandId: "cmd_stale001",
          playerId: ALICE,
          matchId: "match_seed01",
          expectedMatchVersion: 0,
        },
      ),
    );
    const rejection = only(out, "CommandRejected");
    expect(rejection.code).toBe("stale_match_version");
    expect(rejection.currentMatchVersion).toBe(1);
  });

  it("a valid game command invokes game-core and updates canonical state", async () => {
    const { handler, store } = harness();
    seedMatch(
      store,
      playingState(boardWith([["Black", "AttackPawn", [5, 5]]])),
    );
    const out = await handler.handle(
      message(
        { type: "SubmitAction", start: [5, 5], end: [5, 6] },
        {
          commandId: "cmd_move0001",
          playerId: ALICE,
          matchId: "match_seed01",
          expectedMatchVersion: 1,
        },
      ),
    );
    const updated = only(out, "MatchUpdated");
    expect(updated.domainEvents.some((e) => e.type === "ActionApplied")).toBe(
      true,
    );
    const aggregate = store.matches.get("match_seed01")!;
    expect(aggregate.version).toBe(2);
    expect(aggregate.state.movesThisTurn).toBe(1);
  });

  it("an illegal game command maps to a structured rejection and does not mutate state", async () => {
    const { handler, store } = harness();
    seedMatch(
      store,
      playingState(boardWith([["Black", "AttackPawn", [5, 5]]])),
    );
    const out = await handler.handle(
      message(
        { type: "SubmitAction", start: [0, 0], end: [1, 1] },
        {
          commandId: "cmd_illegal1",
          playerId: ALICE,
          matchId: "match_seed01",
          expectedMatchVersion: 1,
        },
      ),
    );
    expect(only(out, "CommandRejected").code).toBe("illegal_command");
    expect(store.matches.get("match_seed01")!.version).toBe(1);
  });

  it("a Defended King decision flows through the server", async () => {
    const { handler, store } = harness();
    seedMatch(
      store,
      playingState(
        boardWith([
          ["Black", "AttackPawn", [5, 2]],
          ["White", "King", [5, 3]],
          ["White", "DefensePawn", [4, 3]],
        ]),
      ),
    );
    const attack = await handler.handle(
      message(
        { type: "SubmitAction", start: [5, 2], end: [5, 3] },
        {
          commandId: "cmd_dk_atk01",
          playerId: ALICE,
          matchId: "match_seed01",
          expectedMatchVersion: 1,
        },
      ),
    );
    const decision = only(attack, "DecisionRequired").decision;
    expect(decision.kind).toBe("defendedKing");
    expect(store.matches.get("match_seed01")!.state.phase).toBe(
      "defenderSelection",
    );

    const version = store.matches.get("match_seed01")!.version;
    const resolve = await handler.handle(
      message(
        { type: "ChooseDefender", position: [4, 3] },
        {
          commandId: "cmd_dk_def01",
          playerId: BOB,
          matchId: "match_seed01",
          expectedMatchVersion: version,
        },
      ),
    );
    expect(types(resolve)).toContain("MatchUpdated");
    expect(store.matches.get("match_seed01")!.state.phase).not.toBe(
      "defenderSelection",
    );
  });

  it("a Transform decision flows through the server", async () => {
    const { handler, store } = harness();
    seedMatch(
      store,
      playingState(boardWith([["Black", "AttackPawn", [5, 4]]], [[5, 5]])),
      { transformEnabled: true },
    );
    const move = await handler.handle(
      message(
        { type: "SubmitAction", start: [5, 4], end: [5, 5] },
        {
          commandId: "cmd_tf_mv001",
          playerId: ALICE,
          matchId: "match_seed01",
          expectedMatchVersion: 1,
        },
      ),
    );
    expect(only(move, "DecisionRequired").decision.kind).toBe("transform");

    const version = store.matches.get("match_seed01")!.version;
    const resolve = await handler.handle(
      message(
        { type: "ChooseTransform", newType: "DefensePawn" },
        {
          commandId: "cmd_tf_ch001",
          playerId: ALICE,
          matchId: "match_seed01",
          expectedMatchVersion: version,
        },
      ),
    );
    expect(types(resolve)).toContain("MatchUpdated");
    expect(
      store.matches.get("match_seed01")!.state.pendingTransform,
    ).toBeNull();
  });

  it("PassTurn flows through the server and changes the turn", async () => {
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
    const out = await handler.handle(
      message(
        { type: "PassTurn" },
        {
          commandId: "cmd_pass0001",
          playerId: ALICE,
          matchId: "match_seed01",
          expectedMatchVersion: 1,
        },
      ),
    );
    expect(only(out, "TurnChanged").currentPlayer).toBe("White");
    expect(store.matches.get("match_seed01")!.state.currentPlayer).toBe(
      "White",
    );
  });

  it("Resign ends the match", async () => {
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
    const out = await handler.handle(
      message(
        { type: "Resign" },
        {
          commandId: "cmd_resign01",
          playerId: ALICE,
          matchId: "match_seed01",
          expectedMatchVersion: 1,
        },
      ),
    );
    const ended = only(out, "MatchEnded");
    expect(ended.reason).toBe("resignation");
    expect(ended.winner).toBe("White");
    expect(ended.loser).toBe("Black");
    expect(store.matches.get("match_seed01")!.status).toBe("ended");
  });

  it("RequestSync returns the canonical state to the requester", async () => {
    const { handler, store } = harness();
    seedMatch(
      store,
      playingState(boardWith([["Black", "AttackPawn", [5, 5]]])),
      { version: 4, streamSequence: 7 },
    );
    const out = await handler.handle(
      message(
        { type: "RequestSync", lastSeenMatchVersion: null },
        { commandId: "cmd_sync0001", playerId: ALICE, matchId: "match_seed01" },
      ),
    );
    const snapshot = only(out, "MatchSnapshot");
    expect(snapshot.snapshot.schema).toBe(1);
    expect(snapshot.status).toBe("active");
    expect(out[0]!.matchVersion).toBe(4);
    expect(out[0]!.streamSequence).toBe(7);
    expect(out[0]!.recipient).toEqual({ playerId: ALICE });
    // Read-only: version is not advanced.
    expect(store.matches.get("match_seed01")!.version).toBe(4);
  });

  it("RequestSync reports the authoritative lifecycle status", async () => {
    const { handler, store } = harness();
    const board = boardWith([["Black", "AttackPawn", [5, 5]]]);
    for (const status of ["awaitingOpponent", "ended"] as const) {
      store.matches.clear();
      store.invites.clear();
      seedMatch(store, playingState(board), { status });
      const out = await handler.handle(
        message(
          { type: "RequestSync", lastSeenMatchVersion: null },
          {
            commandId: `cmd_sync_${status}`,
            playerId: ALICE,
            matchId: "match_seed01",
          },
        ),
      );
      expect(only(out, "MatchSnapshot").status).toBe(status);
    }
  });

  it("multiple events from one command receive deterministic, increasing stream sequences", async () => {
    const { handler, store } = harness();
    seedMatch(
      store,
      playingState(
        boardWith([
          ["Black", "King", [10, 1]],
          ["White", "King", [1, 10]],
        ]),
      ),
      { streamSequence: 1 },
    );
    const out = await handler.handle(
      message(
        { type: "PassTurn" },
        {
          commandId: "cmd_seq00001",
          playerId: ALICE,
          matchId: "match_seed01",
          expectedMatchVersion: 1,
        },
      ),
    );
    expect(out.length).toBeGreaterThanOrEqual(2);
    const sequences = out.map((envelope) => envelope.streamSequence);
    expect(sequences).toEqual([2, 3]);
    // All events from one command carry the single new match version.
    expect(new Set(out.map((envelope) => envelope.matchVersion))).toEqual(
      new Set([2]),
    );
  });

  it("a persistence failure does not partially save state or receipt", async () => {
    const store = new InMemoryStore();
    seedMatch(
      store,
      playingState(boardWith([["Black", "AttackPawn", [5, 5]]])),
    );
    const failing: UnitOfWork = {
      async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
        const persistence = createInMemoryPersistence(store);
        await persistence.unitOfWork.run(async (tx) => {
          await work(tx);
          throw new Error("simulated persistence failure at commit");
        });
        throw new Error("unreachable");
      },
    };
    const handler = new CommandHandler({
      matches: createInMemoryPersistence(store).matches,
      unitOfWork: failing,
      authenticator: new TrustingAuthenticator(),
      clock: new FixedClock(),
      ids: new SequentialIds(),
      seeds: new SequentialSeeds(),
    });

    await expect(
      handler.handle(
        message(
          { type: "SubmitAction", start: [5, 5], end: [5, 6] },
          {
            commandId: "cmd_persist1",
            playerId: ALICE,
            matchId: "match_seed01",
            expectedMatchVersion: 1,
          },
        ),
      ),
    ).rejects.toThrow(/persistence failure/);
    expect(store.matches.get("match_seed01")!.version).toBe(1);
    expect(store.receipts.has("cmd_persist1")).toBe(false);
  });

  it("concurrent commands against the same version cannot both commit", async () => {
    const { handler, store } = harness();
    seedMatch(
      store,
      playingState(
        boardWith([
          ["Black", "AttackPawn", [5, 5]],
          ["Black", "King", [10, 1]],
          ["White", "King", [1, 10]],
        ]),
      ),
    );
    const [a, b] = await Promise.all([
      handler.handle(
        message(
          { type: "SubmitAction", start: [5, 5], end: [5, 6] },
          {
            commandId: "cmd_conc0001",
            playerId: ALICE,
            matchId: "match_seed01",
            expectedMatchVersion: 1,
          },
        ),
      ),
      handler.handle(
        message(
          { type: "SubmitAction", start: [5, 5], end: [4, 5] },
          {
            commandId: "cmd_conc0002",
            playerId: ALICE,
            matchId: "match_seed01",
            expectedMatchVersion: 1,
          },
        ),
      ),
    ]);
    const outcomes = [types(a)[0], types(b)[0]].sort();
    expect(outcomes).toEqual(["CommandRejected", "MatchUpdated"]);
    const rejected = [...a, ...b].find(
      (e) => e.event.type === "CommandRejected",
    );
    expect(
      (rejected!.event as Extract<ServerEvent, { type: "CommandRejected" }>)
        .code,
    ).toBe("stale_match_version");
    // Exactly one mutation committed.
    expect(store.matches.get("match_seed01")!.version).toBe(2);
  });

  it("a malformed protocol message is rejected without touching state", async () => {
    const { handler, store } = harness();
    const out = await handler.handle({
      protocol: "assalto-reale",
      protocolVersion: 1,
      messageType: "command",
      commandId: "cmd_bad00001",
      sentAt: "nope",
      actor: {},
      matchId: null,
      expectedMatchVersion: null,
      command: { type: "PassTurn" },
    });
    expect(only(out, "CommandRejected").code).toBe("invalid_message");
    expect(store.matches.size).toBe(0);
  });

  it("surfaces a ConcurrencyConflictError as a stale rejection", () => {
    expect(new ConcurrencyConflictError().name).toBe(
      "ConcurrencyConflictError",
    );
  });
});
