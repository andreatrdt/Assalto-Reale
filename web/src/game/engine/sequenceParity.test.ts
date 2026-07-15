import { describe, expect, it } from "vitest";
import fixtures from "../../../tests/fixtures/python-engine-fixtures.json";
import { applyAction, buildAction } from "./actions";
import { refreshTerritoryClaim } from "./territory";
import { transformPiece } from "./transform";
import { fromPythonSnapshot, type PythonBoardSnapshot } from "./serialization";
import {
  actionSummary,
  compactSnapshot,
  legalActionSummaries,
  normalizeLegalActions,
  normalizePythonAction,
  normalizePythonResult,
  resultSummary,
} from "./parityReplay";
import type { Action, BoardState, PawnType, Player, Vec2 } from "./types";

// Complete-turn and special-mechanic parity. Each scenario replays the Python
// reference engine's step sequence through the TypeScript engine, threading
// action points and King-acted state exactly as the engine reports them, and
// asserting the legal-action set, built action, transition result and resulting
// normalized snapshot at every step.

type Scenario = (typeof fixtures.scenarios)[number];
type Step = Scenario["steps"][number] & Record<string, unknown>;

function replay(scenario: Scenario): void {
  let board: BoardState = fromPythonSnapshot(scenario.initial as unknown as PythonBoardSnapshot);
  let movesThisTurn = 0;
  let kingMoved = false;

  scenario.steps.forEach((rawStep, index) => {
    const step = rawStep as Step;
    if (step.reset_turn) {
      movesThisTurn = 0;
      kingMoved = false;
    }
    const where = `${scenario.name} step ${index} (${step.kind})`;

    if (step.kind === "action") {
      const start = step.start as unknown as Vec2;
      const end = step.end as unknown as Vec2;
      const selectedDefender = (step.selected_defender as unknown as Vec2 | undefined) ?? undefined;
      const piece = board.grid[start[0]][start[1]];
      const input = step.input as { moves_this_turn: number; king_moved: boolean };

      // Threading parity: our own AP/King accounting must match Python's input.
      expect({ movesThisTurn, kingMoved }, where).toEqual({ movesThisTurn: input.moves_this_turn, kingMoved: input.king_moved });

      if (step.legal_actions && piece) {
        const expected = normalizeLegalActions(step.legal_actions as Array<Record<string, unknown>>);
        expect(legalActionSummaries(board, piece.player, movesThisTurn, kingMoved), `${where} legal actions`).toEqual(expected);
      }

      const action = buildAction(board, start, end, { movesThisTurn, kingMoved, selectedDefender, rulesVersion: 1 });
      expect(actionSummary(action), `${where} action`).toEqual(
        actionSummary(normalizePythonAction(step.action as Record<string, unknown>)),
      );

      const { board: nextBoard, result } = applyAction(board, action, { movesThisTurn, kingMoved, rulesVersion: 1 });
      expect(resultSummary(result), `${where} result`).toEqual(normalizePythonResult(step.result as Record<string, unknown>));
      board = nextBoard;
      expect(compactSnapshot(board), `${where} snapshot`).toEqual(step.snapshot);
      movesThisTurn = result.nextMovesThisTurn;
      kingMoved = result.nextKingMoved;
    } else if (step.kind === "pass") {
      const player = step.player as Player;
      const input = step.input as { moves_this_turn: number; king_moved: boolean };
      expect({ movesThisTurn, kingMoved }, where).toEqual({ movesThisTurn: input.moves_this_turn, kingMoved: input.king_moved });

      const action: Action = { kind: "pass", player, cost: 0, capture: false, endsTurn: true };
      expect(actionSummary(action), `${where} action`).toEqual(
        actionSummary(normalizePythonAction(step.action as Record<string, unknown>)),
      );

      const { board: nextBoard, result } = applyAction(board, action, { movesThisTurn, kingMoved, rulesVersion: 1 });
      expect(resultSummary(result), `${where} result`).toEqual(normalizePythonResult(step.result as Record<string, unknown>));
      board = nextBoard;
      expect(compactSnapshot(board), `${where} snapshot`).toEqual(step.snapshot);
      movesThisTurn = result.nextMovesThisTurn;
      kingMoved = result.nextKingMoved;
    } else if (step.kind === "transform") {
      const pos = step.pos as unknown as Vec2;
      const newType = step.new_type as PawnType;
      const seed = (step.seed as number | null) ?? undefined;
      const { board: nextBoard, result } = transformPiece(board, pos, newType, seed);
      expect(resultSummary(result), `${where} result`).toEqual(normalizePythonResult(step.result as Record<string, unknown>));
      board = nextBoard;
      expect(compactSnapshot(board), `${where} snapshot`).toEqual(step.snapshot);
      movesThisTurn = 0;
      kingMoved = false;
    } else if (step.kind === "refresh_territory") {
      const turn = step.turn as number;
      expect(refreshTerritoryClaim(board, turn), `${where} victory`).toEqual(step.victory);
      expect(compactSnapshot(board), `${where} snapshot`).toEqual(step.snapshot);
    } else {
      throw new Error(`Unknown step kind in ${where}`);
    }
  });
}

describe("complete-turn and mechanic parity (Python reference vs TypeScript)", () => {
  it.each(fixtures.scenarios.map((scenario) => scenario.name))("%s", (name) => {
    const scenario = fixtures.scenarios.find((candidate) => candidate.name === name)!;
    replay(scenario);
  });
});
