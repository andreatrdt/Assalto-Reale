import { pieceIdAt, setPiece } from "@assalto-reale/game-core";
import { describe, expect, it } from "vitest";
import {
  applyGameCommand,
  type MatchAggregate,
} from "../src/domain/matchAggregate.js";
import {
  ALICE,
  BOB,
  ONLINE_CONFIG,
  boardWith,
  playingState,
} from "./support.js";

function aggregate(): MatchAggregate {
  const board = boardWith([
    ["Black", "King", [11, 11]],
    ["Black", "AttackPawn", [5, 5]],
    ["White", "King", [5, 6]],
    ["White", "DefensePawn", [4, 6]],
  ]);
  for (let col = 0; col <= 4; col += 1)
    setPiece(board, [5, col], { player: "White", type: "ConquestPawn" });
  return {
    matchId: "match_route01",
    inviteCode: "ROUTE001",
    version: 1,
    streamSequence: 1,
    seed: 42,
    config: ONLINE_CONFIG,
    members: { Black: ALICE, White: BOB },
    status: "active",
    state: playingState(board),
    endReason: null,
    postGame: null,
    rematchOfferedBy: null,
    successorMatchId: null,
    predecessorMatchId: null,
    historyEventSequence: 0,
    historyCaptureStartedAtVersion: null,
  };
}

describe("authoritative defended-King routes", () => {
  it("auto-sacrifices the path defender and publishes the resolved route", () => {
    const initial = aggregate();
    setPiece(initial.state.board, [5, 5], null);
    setPiece(initial.state.board, [5, 3], {
      player: "Black",
      type: "AttackPawn",
    });
    setPiece(initial.state.board, [5, 4], {
      player: "White",
      type: "DefensePawn",
    });
    setPiece(initial.state.board, [5, 6], null);
    setPiece(initial.state.board, [5, 5], { player: "White", type: "King" });
    for (let col = 0; col <= 2; col += 1)
      setPiece(initial.state.board, [5, col], null);
    const pathDefenderId = pieceIdAt(initial.state.board, [5, 4]);

    const result = applyGameCommand(initial, "Black", {
      type: "SubmitAction",
      start: [5, 3],
      end: [5, 5],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aggregate.state.board.grid[5]?.[4]).toBeNull();
    expect(result.aggregate.state.board.grid[5]?.[5]).toEqual({
      player: "White",
      type: "King",
    });
    expect(result.aggregate.state.board.capturedPieces.White.DefensePawn).toBe(
      1,
    );
    const update = result.emissions.find(
      (emission) => emission.event.type === "MatchUpdated",
    );
    expect(
      update?.event.type === "MatchUpdated" ? update.event.domainEvents : [],
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ActionApplied",
          transition: expect.objectContaining({
            events: expect.arrayContaining([
              expect.objectContaining({
                kind: "defended_king",
                data: expect.objectContaining({
                  path_defender: pathDefenderId,
                }),
              }),
              expect.objectContaining({ kind: "bounce" }),
            ]),
          }),
        }),
      ]),
    );
  });

  it("rejects a missing or stale semantic route and commits an offered route", () => {
    const initial = aggregate();
    const missing = applyGameCommand(initial, "Black", {
      type: "SubmitAction",
      start: [5, 5],
      end: [5, 6],
    });
    expect(missing.ok).toBe(false);

    const stale = applyGameCommand(initial, "Black", {
      type: "SubmitAction",
      start: [5, 5],
      end: [5, 6],
      routeId: "primary",
    });
    expect(stale.ok).toBe(false);

    const selected = applyGameCommand(initial, "Black", {
      type: "SubmitAction",
      start: [5, 5],
      end: [5, 6],
      routeId: "clockwise",
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.aggregate.state.phase).toBe("defenderSelection");
    expect(
      selected.aggregate.state.pendingDefendedKing?.preview.selectedRouteId,
    ).toBe("clockwise");
  });
});
