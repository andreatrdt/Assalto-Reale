import { describe, expect, it } from "vitest";
import type {
  ServerEvent,
  ServerEventEnvelope,
} from "@assalto-reale/multiplayer-protocol";
import {
  ALICE,
  BOB,
  boardWith,
  harness,
  message,
  playingState,
  seedMatch,
} from "./support.js";

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
      `No ${type} for ${playerId ?? "any"} in [${envelopes
        .map((e) => e.event.type)
        .join(", ")}]`,
    );
  }
  return found.event as Extract<ServerEvent, { type: T }>;
}

/** Seed a completed match (ALICE = Black, BOB = White) ready for a rematch. */
function endedMatch(): ReturnType<typeof harness> {
  const h = harness();
  seedMatch(h.store, playingState(TERMINAL_BOARD), {
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
});
