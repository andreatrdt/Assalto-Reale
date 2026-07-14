import { describe, expect, it } from "vitest";
import type {
  ServerEvent,
  ServerEventEnvelope,
} from "@assalto-reale/multiplayer-protocol";
import {
  CURRENT_GAME_RULES_VERSION,
  replayHistoricalMatch,
} from "@assalto-reale/game-core";
import {
  ALICE,
  BOB,
  boardWith,
  harness,
  message,
  playingState,
  seedMatch,
} from "./support.js";
import type { Clock } from "../src/index.js";

class MutableClock implements Clock {
  constructor(public current = new Date("2026-01-01T00:00:00.000Z")) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

const TERMINAL_BOARD = boardWith([
  ["Black", "King", [10, 1]],
  ["White", "King", [1, 10]],
]);

const CAROL = "player_carol01";

function eventFor<T extends ServerEvent["type"]>(
  envelopes: ServerEventEnvelope[],
  type: T,
  playerId?: string,
): Extract<ServerEvent, { type: T }> {
  const found = envelopes.find(
    (envelope) =>
      envelope.event.type === type &&
      (playerId === undefined ||
        (envelope.recipient !== "all" &&
          envelope.recipient.playerId === playerId)),
  );
  if (!found) {
    throw new Error(
      `No ${type} for ${playerId ?? "any"} in [${envelopes.map((e) => e.event.type).join(", ")}]`,
    );
  }
  return found.event as Extract<ServerEvent, { type: T }>;
}

/** Seed a completed match (ALICE = Black, BOB = White) ready for a rematch. */
function endedMatch(rulesVersion: 1 | 2 = 2): ReturnType<typeof harness> {
  const h = harness();
  seedMatch(h.store, playingState(TERMINAL_BOARD, { rulesVersion }), {
    matchId: "match_done0001",
    inviteCode: "DONE0001",
    version: 5,
    streamSequence: 5,
    members: { Black: ALICE, White: BOB },
    status: "ended",
    endReason: "resignation",
  });
  return h;
}

const MATCH = "match_done0001";

describe("authoritative rematch lifecycle", () => {
  it.each([1, 2] as const)(
    "creates a rules-v2 rematch from a rules-v%s completed match without changing its predecessor",
    async (rulesVersion) => {
      const { handler, store } = endedMatch(rulesVersion);
      await handler.handle(
        message(
          { type: "OfferRematch" },
          {
            commandId: `cmd_offer_rules${rulesVersion}`,
            playerId: ALICE,
            matchId: MATCH,
          },
        ),
      );
      const created = await handler.handle(
        message(
          { type: "RespondToRematch", accept: true },
          {
            commandId: `cmd_accept_rules${rulesVersion}`,
            playerId: BOB,
            matchId: MATCH,
          },
        ),
      );
      const successorId = eventFor(created, "RematchCreated", BOB).newMatchId;
      const predecessor = store.matches.get(MATCH)!;
      const successor = store.matches.get(successorId)!;

      expect(successor.state.rulesVersion).toBe(CURRENT_GAME_RULES_VERSION);
      expect(successor.predecessorMatchId).toBe(MATCH);
      expect(predecessor.successorMatchId).toBe(successorId);
      expect(predecessor.state.rulesVersion).toBe(rulesVersion);
    },
  );

  it("keeps an original rules-v1 replay unchanged and deterministic after rematch creation", async () => {
    const replayInput = {
      rulesVersion: 1,
      replaySchemaVersion: 1,
      seed: 73,
      placementMode: "Manual" as const,
      transformEnabled: true,
      events: [
        {
          sequenceNumber: 1,
          actorSide: "White" as const,
          payload: {
            schemaVersion: 1,
            command: { type: "Resign" as const },
          },
        },
      ],
    };
    const encodedBefore = JSON.stringify(replayInput);
    const first = replayHistoricalMatch(replayInput);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.frames[0]?.state.rulesVersion).toBe(1);

    const { handler, store } = endedMatch(1);
    await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_offer_v1_replay", playerId: ALICE, matchId: MATCH },
      ),
    );
    const created = await handler.handle(
      message(
        { type: "RespondToRematch", accept: true },
        { commandId: "cmd_accept_v1_replay", playerId: BOB, matchId: MATCH },
      ),
    );
    const successorId = eventFor(created, "RematchCreated", BOB).newMatchId;
    const second = replayHistoricalMatch(replayInput);

    expect(JSON.stringify(replayInput)).toBe(encodedBefore);
    expect(second).toEqual(first);
    expect(store.matches.get(MATCH)?.state.rulesVersion).toBe(1);
    expect(store.matches.get(MATCH)?.successorMatchId).toBe(successorId);
    expect(store.matches.get(successorId)?.predecessorMatchId).toBe(MATCH);
    expect(store.matches.get(successorId)?.state.rulesVersion).toBe(
      CURRENT_GAME_RULES_VERSION,
    );
  });

  it("rejects a rematch request for a match that has not ended", async () => {
    const { handler, store } = harness();
    seedMatch(store, playingState(TERMINAL_BOARD), {
      matchId: MATCH,
      members: { Black: ALICE, White: BOB },
      status: "active",
    });
    const out = await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_offer0001", playerId: ALICE, matchId: MATCH },
      ),
    );
    expect(eventFor(out, "CommandRejected").code).toBe("illegal_command");
  });

  it("rejects a rematch request from a non-member", async () => {
    const { handler } = endedMatch();
    const out = await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_offer0001", playerId: CAROL, matchId: MATCH },
      ),
    );
    expect(eventFor(out, "CommandRejected").code).toBe("unauthorized");
  });

  it("records an offer and notifies the opponent", async () => {
    const { handler, store } = endedMatch();
    const out = await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_offer0001", playerId: ALICE, matchId: MATCH },
      ),
    );
    const offered = eventFor(out, "RematchOffered", BOB);
    expect(offered.offeredByPlayerId).toBe(ALICE);
    expect(store.matches.get(MATCH)?.rematchOfferedBy).toBe(ALICE);
  });

  it("creates a fresh, swapped-side rematch with the same players on acceptance", async () => {
    const { handler, store } = endedMatch();
    await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_offer0001", playerId: ALICE, matchId: MATCH },
      ),
    );
    const out = await handler.handle(
      message(
        { type: "RespondToRematch", accept: true },
        { commandId: "cmd_accept001", playerId: BOB, matchId: MATCH },
      ),
    );

    const forAlice = eventFor(out, "RematchCreated", ALICE);
    const forBob = eventFor(out, "RematchCreated", BOB);
    const newId = forAlice.newMatchId;
    expect(newId).not.toBe(MATCH);
    expect(forBob.newMatchId).toBe(newId);
    // Sides swap: ALICE was Black, is now White; BOB was White, is now Black.
    expect(forAlice.assignedSide).toBe("White");
    expect(forBob.assignedSide).toBe("Black");

    const successor = store.matches.get(newId)!;
    expect(successor.members).toEqual({ Black: BOB, White: ALICE });
    expect(successor.status).toBe("active");
    expect(successor.state.phase).toBe("placement");
    expect(successor.version).toBe(1);
    expect(successor.streamSequence).toBe(1);
    expect(successor.endReason).toBeNull();
    expect(successor.predecessorMatchId).toBe(MATCH);

    const previous = store.matches.get(MATCH)!;
    expect(previous.successorMatchId).toBe(newId);
    expect(previous.rematchOfferedBy).toBeNull();
    // The old and new aggregates are distinct.
    expect(previous.matchId).not.toBe(successor.matchId);
    expect(previous.state).not.toBe(successor.state);
  });

  it("declines a rematch and notifies the offerer", async () => {
    const { handler, store } = endedMatch();
    await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_offer0001", playerId: ALICE, matchId: MATCH },
      ),
    );
    const out = await handler.handle(
      message(
        { type: "RespondToRematch", accept: false },
        { commandId: "cmd_decline01", playerId: BOB, matchId: MATCH },
      ),
    );
    expect(eventFor(out, "RematchDeclined", ALICE).declinedByPlayerId).toBe(
      BOB,
    );
    expect(store.matches.get(MATCH)?.rematchOfferedBy).toBeNull();
    expect(store.matches.get(MATCH)?.successorMatchId).toBeNull();
  });

  it("does not let the offerer accept their own offer", async () => {
    const { handler } = endedMatch();
    await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_offer0001", playerId: ALICE, matchId: MATCH },
      ),
    );
    const out = await handler.handle(
      message(
        { type: "RespondToRematch", accept: true },
        { commandId: "cmd_accept001", playerId: ALICE, matchId: MATCH },
      ),
    );
    expect(eventFor(out, "CommandRejected").code).toBe("unauthorized");
  });

  it("rejects a response when no rematch was offered", async () => {
    const { handler } = endedMatch();
    const out = await handler.handle(
      message(
        { type: "RespondToRematch", accept: true },
        { commandId: "cmd_accept001", playerId: BOB, matchId: MATCH },
      ),
    );
    expect(eventFor(out, "CommandRejected").code).toBe("illegal_command");
  });

  it("creates at most one successor under duplicate acceptance", async () => {
    const { handler, store } = endedMatch();
    await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_offer0001", playerId: ALICE, matchId: MATCH },
      ),
    );
    const first = await handler.handle(
      message(
        { type: "RespondToRematch", accept: true },
        { commandId: "cmd_accept001", playerId: BOB, matchId: MATCH },
      ),
    );
    const second = await handler.handle(
      message(
        { type: "RespondToRematch", accept: true },
        { commandId: "cmd_accept002", playerId: BOB, matchId: MATCH },
      ),
    );
    const firstId = eventFor(first, "RematchCreated", BOB).newMatchId;
    const secondId = eventFor(second, "RematchCreated", BOB).newMatchId;
    expect(secondId).toBe(firstId);
    // Only the original match plus a single successor exist.
    expect(store.matches.size).toBe(2);
  });

  it("resolves near-simultaneous mutual offers into a single rematch", async () => {
    const { handler, store } = endedMatch();
    await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_offer0001", playerId: ALICE, matchId: MATCH },
      ),
    );
    // BOB offers too (instead of RespondToRematch); this accepts ALICE's offer.
    const out = await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_offer0002", playerId: BOB, matchId: MATCH },
      ),
    );
    expect(eventFor(out, "RematchCreated", BOB).newMatchId).not.toBe(MATCH);
    expect(store.matches.size).toBe(2);
  });

  it("steers a reconnecting player into the successor via RequestSync", async () => {
    const { handler } = endedMatch();
    await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_offer0001", playerId: ALICE, matchId: MATCH },
      ),
    );
    const created = await handler.handle(
      message(
        { type: "RespondToRematch", accept: true },
        { commandId: "cmd_accept001", playerId: BOB, matchId: MATCH },
      ),
    );
    const newId = eventFor(created, "RematchCreated", BOB).newMatchId;

    // ALICE reconnects and syncs the OLD match; the server redirects to the new one.
    const sync = await handler.handle(
      message(
        { type: "RequestSync", lastSeenMatchVersion: null },
        { commandId: "cmd_sync00001", playerId: ALICE, matchId: MATCH },
      ),
    );
    const redirect = eventFor(sync, "RematchCreated", ALICE);
    expect(redirect.newMatchId).toBe(newId);
    expect(redirect.assignedSide).toBe("White");
  });

  it("rejects stale gameplay commands against the completed match", async () => {
    const { handler, store } = endedMatch();
    const version = store.matches.get(MATCH)!.version;
    const out = await handler.handle(
      message(
        { type: "PassTurn" },
        {
          commandId: "cmd_pass00001",
          playerId: ALICE,
          matchId: MATCH,
          expectedMatchVersion: version,
        },
      ),
    );
    expect(eventFor(out, "CommandRejected").code).toBe("match_ended");
  });

  it("makes deliberate departure immediate, cancels an offer, and preserves the result", async () => {
    const { handler, store } = endedMatch();
    const completedState = JSON.stringify(store.matches.get(MATCH)?.state);
    await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_offer_leave", playerId: ALICE, matchId: MATCH },
      ),
    );
    const out = await handler.handle(
      message(
        { type: "LeavePostGame" },
        { commandId: "cmd_leave_bob01", playerId: BOB, matchId: MATCH },
      ),
    );
    const presence = eventFor(out, "PostGamePresenceChanged");
    expect(presence.presence).toBe("absent");
    expect(presence.offerCancelled).toBe(true);
    const aggregate = store.matches.get(MATCH)!;
    expect(aggregate.rematchOfferedBy).toBeNull();
    expect(JSON.stringify(aggregate.state)).toBe(completedState);
    expect(aggregate.status).toBe("ended");
    expect(aggregate.endReason).toBe("resignation");
  });

  it("rejects rematch actions while either player is absent", async () => {
    const { handler } = endedMatch();
    await handler.handle(
      message(
        { type: "LeavePostGame" },
        { commandId: "cmd_leave_bob02", playerId: BOB, matchId: MATCH },
      ),
    );
    const out = await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_stale_offer", playerId: ALICE, matchId: MATCH },
      ),
    );
    expect(eventFor(out, "CommandRejected").code).toBe("post_game_unavailable");
  });

  it("keeps rematch availability during reconnect grace, then expires it", async () => {
    const clock = new MutableClock();
    const h = harness({
      clock,
      postGameReconnectGraceMs: 30_000,
    });
    seedMatch(h.store, playingState(TERMINAL_BOARD), {
      matchId: MATCH,
      status: "ended",
      endReason: "resignation",
    });
    const disconnected = await h.handler.markPostGameDisconnected(
      { playerId: BOB, sessionId: "bob_session" },
      MATCH,
    );
    expect(
      eventFor(disconnected.envelopes, "PostGamePresenceChanged").presence,
    ).toBe("grace");
    const offered = await h.handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_grace_offer", playerId: ALICE, matchId: MATCH },
      ),
    );
    expect(eventFor(offered, "RematchOffered").offeredByPlayerId).toBe(ALICE);
    clock.advance(30_001);
    const expired = await h.handler.expirePostGameDisconnect(
      { playerId: BOB, sessionId: "bob_session" },
      MATCH,
    );
    expect(
      eventFor(expired.envelopes, "PostGamePresenceChanged").presence,
    ).toBe("absent");
    expect(h.store.matches.get(MATCH)?.rematchOfferedBy).toBeNull();
  });

  it("refresh re-entry preserves participation but never revives an expired offer", async () => {
    const { handler, store } = endedMatch();
    await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_offer_refresh", playerId: ALICE, matchId: MATCH },
      ),
    );
    await handler.handle(
      message(
        { type: "LeavePostGame" },
        { commandId: "cmd_leave_refresh", playerId: BOB, matchId: MATCH },
      ),
    );
    const sync = await handler.handle(
      message(
        { type: "RequestSync", lastSeenMatchVersion: null },
        { commandId: "cmd_sync_refresh", playerId: BOB, matchId: MATCH },
      ),
    );
    expect(eventFor(sync, "MatchSnapshot").postGame?.presence.White).toBe(
      "present",
    );
    expect(store.matches.get(MATCH)?.rematchOfferedBy).toBeNull();
  });

  it("applies duplicate departures exactly once", async () => {
    const { handler, store } = endedMatch();
    const first = await handler.handle(
      message(
        { type: "LeavePostGame" },
        { commandId: "cmd_leave_once", playerId: ALICE, matchId: MATCH },
      ),
    );
    const version = store.matches.get(MATCH)!.version;
    const second = await handler.handle(
      message(
        { type: "LeavePostGame" },
        { commandId: "cmd_leave_twice", playerId: ALICE, matchId: MATCH },
      ),
    );
    expect(eventFor(first, "PostGamePresenceChanged").presence).toBe("absent");
    expect(eventFor(second, "MatchSnapshot").postGame?.presence.Black).toBe(
      "absent",
    );
    expect(store.matches.get(MATCH)!.version).toBe(version);
  });

  it("does not replay a stale rematch receipt after departure", async () => {
    const { handler, store } = endedMatch();
    const offer = message(
      { type: "OfferRematch" },
      { commandId: "cmd_replay_offer", playerId: ALICE, matchId: MATCH },
    );
    await handler.handle(offer);
    await handler.handle(
      message(
        { type: "LeavePostGame" },
        { commandId: "cmd_leave_replay", playerId: BOB, matchId: MATCH },
      ),
    );
    const replay = await handler.handle(offer);
    expect(
      eventFor(replay, "MatchSnapshot").postGame?.rematchOfferedBy,
    ).toBeNull();
    expect(store.matches.size).toBe(1);
  });

  it("makes Home followed by immediate return deterministic", async () => {
    const { handler } = endedMatch();
    await handler.handle(
      message(
        { type: "LeavePostGame" },
        { commandId: "cmd_home_now01", playerId: ALICE, matchId: MATCH },
      ),
    );
    const returned = await handler.handle(
      message(
        { type: "RequestSync", lastSeenMatchVersion: null },
        { commandId: "cmd_return_now", playerId: ALICE, matchId: MATCH },
      ),
    );
    const snapshot = eventFor(returned, "MatchSnapshot");
    expect(snapshot.postGame?.presence.Black).toBe("present");
    expect(snapshot.postGame?.rematchOfferedBy).toBeNull();
  });

  it("converges simultaneous departures and explicit departure plus close", async () => {
    const { handler, store } = endedMatch();
    await Promise.all([
      handler.handle(
        message(
          { type: "LeavePostGame" },
          { commandId: "cmd_both_alice", playerId: ALICE, matchId: MATCH },
        ),
      ),
      handler.handle(
        message(
          { type: "LeavePostGame" },
          { commandId: "cmd_both_bob01", playerId: BOB, matchId: MATCH },
        ),
      ),
    ]);
    const version = store.matches.get(MATCH)!.version;
    await handler.markPostGameDisconnected(
      { playerId: ALICE, sessionId: "alice_session" },
      MATCH,
    );
    const aggregate = store.matches.get(MATCH)!;
    expect(aggregate.postGame?.Black.presence).toBe("absent");
    expect(aggregate.postGame?.White.presence).toBe("absent");
    expect(aggregate.version).toBe(version);
  });

  it("restores durable absence after a server restart", async () => {
    const first = endedMatch();
    await first.handler.handle(
      message(
        { type: "LeavePostGame" },
        { commandId: "cmd_restart_leave", playerId: BOB, matchId: MATCH },
      ),
    );
    const restarted = harness({ store: first.store });
    const rejected = await restarted.handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_restart_offer", playerId: ALICE, matchId: MATCH },
      ),
    );
    expect(eventFor(rejected, "CommandRejected").code).toBe(
      "post_game_unavailable",
    );
  });

  it("does not roll back a successor after the creation commit boundary", async () => {
    const { handler, store } = endedMatch();
    await handler.handle(
      message(
        { type: "OfferRematch" },
        { commandId: "cmd_commit_offer", playerId: ALICE, matchId: MATCH },
      ),
    );
    const created = await handler.handle(
      message(
        { type: "RespondToRematch", accept: true },
        { commandId: "cmd_commit_accept", playerId: BOB, matchId: MATCH },
      ),
    );
    const successor = eventFor(created, "RematchCreated", BOB).newMatchId;
    const lateLeave = await handler.handle(
      message(
        { type: "LeavePostGame" },
        { commandId: "cmd_commit_leave", playerId: BOB, matchId: MATCH },
      ),
    );
    expect(eventFor(lateLeave, "RematchCreated", BOB).newMatchId).toBe(
      successor,
    );
    expect(store.matches.get(successor)?.status).toBe("active");
    expect(store.matches.get(MATCH)?.successorMatchId).toBe(successor);
  });

  it("uses the same presence rules for guest and registered principals", async () => {
    const guest = endedMatch();
    const registered = endedMatch();
    const guestUpdate = await guest.handler.markPostGameDisconnected(
      { playerId: BOB, sessionId: "guest_session", authKind: "guest" },
      MATCH,
    );
    const registeredUpdate = await registered.handler.markPostGameDisconnected(
      {
        playerId: BOB,
        sessionId: "registered_session",
        authKind: "registered",
      },
      MATCH,
    );
    expect(
      eventFor(guestUpdate.envelopes, "PostGamePresenceChanged").presence,
    ).toBe("grace");
    expect(
      eventFor(registeredUpdate.envelopes, "PostGamePresenceChanged").presence,
    ).toBe("grace");
  });
});
