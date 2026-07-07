import { describe, expect, it } from "vitest";
import fixtures from "../../../tests/fixtures/python-engine-fixtures.json";
import { applyAction, buildAction } from "./actions";
import { canPlacePiece } from "./placement";
import { fromPythonSnapshot, toPythonSnapshot, type PythonBoardSnapshot } from "./serialization";
import { getSpecialControl, refreshTerritoryClaim } from "./territory";
import type { Action, DefendedKingPreview, PieceType, Player, Vec2 } from "./types";

type FixtureCase = (typeof fixtures.cases)[number];

function findCase(name: string): FixtureCase {
  const match = fixtures.cases.find((fixture) => fixture.name === name);
  if (!match) {
    throw new Error(`Missing fixture ${name}`);
  }
  return match;
}

function normalizePythonPreview(preview: Record<string, unknown> | null | undefined): DefendedKingPreview | null {
  if (!preview) {
    return null;
  }
  return {
    attackerId: preview.attacker_id as string,
    kingId: preview.king_id as string,
    attackerOrigin: preview.attacker_origin as Vec2,
    kingPosition: preview.king_position as Vec2,
    attackDirection: preview.attack_direction as Vec2,
    bounceDirection: preview.bounce_direction as Vec2,
    attackPath: preview.attack_path as Vec2[],
    bouncePath: preview.bounce_path as Vec2[],
    landingPosition: preview.landing_position as Vec2,
    eligibleDefenderIds: preview.eligible_defender_ids as string[],
    triggersTransform: preview.triggers_transform as boolean,
    actionCost: preview.action_cost as number,
    endsTurn: preview.ends_turn as boolean,
  };
}

function normalizePythonAction(action: Record<string, unknown>): Action {
  return {
    kind: action.kind as Action["kind"],
    player: action.player as Action["player"],
    start: action.start as Vec2 | undefined,
    end: action.end as Vec2 | undefined,
    cost: action.cost as number,
    capture: action.capture as boolean,
    capturedPlayer: action.captured_player as Player | undefined,
    capturedPieceType: action.captured_piece_type as PieceType | undefined,
    targetPieceType: action.target_piece_type as PieceType | undefined,
    defendedKing: normalizePythonPreview(action.defended_king as Record<string, unknown> | null),
    selectedDefender: (action.selected_defender as Vec2 | null) ?? null,
    endsTurn: action.ends_turn as boolean,
    error: (action.error as string | null) ?? undefined,
  };
}

function actionSummary(action: Action) {
  return {
    kind: action.kind,
    player: action.player,
    start: action.start,
    end: action.end,
    cost: action.cost,
    capture: action.capture,
    capturedPlayer: action.capturedPlayer ?? null,
    capturedPieceType: action.capturedPieceType ?? null,
    targetPieceType: action.targetPieceType ?? null,
    defendedKing: action.defendedKing ?? null,
    selectedDefender: action.selectedDefender ?? null,
    endsTurn: action.endsTurn,
    error: action.error ?? null,
  };
}

function resultSummary(result: ReturnType<typeof applyAction>["result"]) {
  return {
    events: result.events,
    victory: result.victory,
    endsTurn: result.endsTurn,
    nextMovesThisTurn: result.nextMovesThisTurn,
    nextKingMoved: result.nextKingMoved,
  };
}

function normalizePythonResult(result: Record<string, unknown>) {
  return {
    events: result.events,
    victory: result.victory,
    endsTurn: result.ends_turn,
    nextMovesThisTurn: result.next_moves_this_turn,
    nextKingMoved: result.next_king_moved,
  };
}

describe("TypeScript engine parity fixtures", () => {
  it.each(["simple_move", "two_square_capture", "defended_king"])("matches Python action and transition for %s", (name) => {
    const fixture = findCase(name);
    const board = fromPythonSnapshot(fixture.initial as PythonBoardSnapshot);
    const input = fixture.input as unknown as {
      start: Vec2;
      end: Vec2;
      moves_this_turn: number;
      king_moved: boolean;
      selected_defender?: Vec2;
    };
    const action = buildAction(board, input.start, input.end, {
      movesThisTurn: input.moves_this_turn,
      kingMoved: input.king_moved,
      selectedDefender: input.selected_defender,
    });
    expect(actionSummary(action)).toEqual(actionSummary(normalizePythonAction(fixture.action as Record<string, unknown>)));

    const { board: finalBoard, result } = applyAction(board, action, {
      movesThisTurn: input.moves_this_turn,
      kingMoved: input.king_moved,
    });
    expect(resultSummary(result)).toEqual(normalizePythonResult(fixture.result as Record<string, unknown>));
    expect(toPythonSnapshot(finalBoard)).toEqual(fixture.final);
  });

  it("matches Python placement restriction reasons", () => {
    const fixture = findCase("placement_restrictions");
    const board = fromPythonSnapshot(fixture.initial as PythonBoardSnapshot);
    for (const check of fixture.checks as unknown as Array<{ pos: Vec2; player: Player; ptype: PieceType; result: { ok: boolean; reason?: string | null } }>) {
      const result = canPlacePiece(board, check.pos, check.player, check.ptype);
      expect({ ok: result.ok, reason: result.reason ?? null }).toEqual(check.result);
    }
  });

  it("matches Python territory claim lifecycle", () => {
    const fixture = findCase("territory_claim");
    const board = fromPythonSnapshot(fixture.final as PythonBoardSnapshot);
    board.territoryClaim = null;
    expect(refreshTerritoryClaim(board, 1)).toEqual(fixture.first);
    expect(refreshTerritoryClaim(board, 3)).toEqual(fixture.second);
    const control = fixture.control as unknown as {
      controlled: Record<Player, Vec2[]>;
      required_majority: number;
      claim: { claimant: Player; created_turn: number; mature_turn: number } | null;
    };
    expect(getSpecialControl(board)).toEqual({
      controlled: control.controlled,
      requiredMajority: control.required_majority,
      claim: control.claim
        ? {
            claimant: control.claim.claimant,
            createdTurn: control.claim.created_turn,
            matureTurn: control.claim.mature_turn,
          }
        : null,
    });
  });
});
