// Shared helpers for the Python⇄TypeScript parity test suites: normalizers that
// map the Python reference engine's snake_case encodings onto the TypeScript
// engine's shapes, comparable summaries, and a legal-action-set generator that
// mirrors the Python `Board.legal_actions`. Kept out of the test files so the
// single-action (pythonParity) and sequence (sequenceParity) suites share one
// definition of "equal".

import { buildAction } from "./actions.js";
import { inBounds } from "./board.js";
import { toPythonSnapshot } from "./serialization.js";
import type { Action, DefendedKingPreview, PieceType, Player, Vec2 } from "./types.js";
import type { BoardState } from "./types.js";

// Compact, lossless projection matching the Python `compact_snapshot`: the full
// grid is replaced by a row-major sparse piece list. Used for per-step board
// comparison so the committed fixture stays small.
export function compactSnapshot(board: BoardState) {
  const snap = toPythonSnapshot(board);
  const pieces: Array<[number, number, string, string]> = [];
  for (let row = 0; row < board.config.rows; row += 1) {
    for (let col = 0; col < board.config.cols; col += 1) {
      const piece = board.grid[row][col];
      if (piece) {
        pieces.push([row, col, piece.player, piece.type]);
      }
    }
  }
  return {
    config: snap.config,
    pieces,
    special_squares: snap.special_squares,
    transform_squares: snap.transform_squares,
    controlled_squares: snap.controlled_squares,
    captured_pieces: snap.captured_pieces,
    territory_claim: snap.territory_claim,
  };
}

export function normalizePythonPreview(preview: Record<string, unknown> | null | undefined): DefendedKingPreview | null {
  if (!preview) {
    return null;
  }
  const bouncePath = preview.bounce_path as Vec2[];
  const landingPosition = preview.landing_position as Vec2;
  return {
    attackerId: preview.attacker_id as string,
    kingId: preview.king_id as string,
    attackerOrigin: preview.attacker_origin as Vec2,
    kingPosition: preview.king_position as Vec2,
    attackDirection: preview.attack_direction as Vec2,
    bounceDirection: preview.bounce_direction as Vec2,
    attackPath: preview.attack_path as Vec2[],
    bouncePath,
    landingPosition,
    routes: [{ id: "primary", path: bouncePath, jumpedSquares: [], turnSquares: [], landingPosition }],
    selectedRouteId: "primary",
    pathDefenderId: null,
    eligibleDefenderIds: preview.eligible_defender_ids as string[],
    triggersTransform: preview.triggers_transform as boolean,
    actionCost: preview.action_cost as number,
    endsTurn: preview.ends_turn as boolean,
  };
}

export function normalizePythonAction(action: Record<string, unknown>): Action {
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

// null-safe start/end so that pass actions (no coordinates) compare equal across
// engines (Python emits null, TypeScript emits undefined).
export function actionSummary(action: Action) {
  return {
    kind: action.kind,
    player: action.player,
    start: action.start ?? null,
    end: action.end ?? null,
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

export function resultSummary(result: {
  events: unknown;
  victory: unknown;
  endsTurn: boolean;
  nextMovesThisTurn: number;
  nextKingMoved: boolean;
}) {
  return {
    events: result.events,
    victory: result.victory,
    endsTurn: result.endsTurn,
    nextMovesThisTurn: result.nextMovesThisTurn,
    nextKingMoved: result.nextKingMoved,
  };
}

export function normalizePythonResult(result: Record<string, unknown>) {
  return {
    events: result.events,
    victory: result.victory,
    endsTurn: result.ends_turn,
    nextMovesThisTurn: result.next_moves_this_turn,
    nextKingMoved: result.next_king_moved,
  };
}

type LegalActionSummary = ReturnType<typeof actionSummary>;

function sortKey(summary: LegalActionSummary): string {
  const start = summary.start ? `${summary.start[0]},${summary.start[1]}` : "-1,-1";
  const end = summary.end ? `${summary.end[0]},${summary.end[1]}` : "-1,-1";
  return `${summary.kind}|${start}|${end}`;
}

/**
 * Mirror of the Python `Board.legal_actions`: for the given player, try every
 * piece against every offset in [-2..2]^2 (excluding no-op), keep actions the
 * engine accepts, and append the pass action. Returned as sorted summaries so
 * the two engines' legal-action *sets* compare regardless of iteration order.
 */
export function legalActionSummaries(board: BoardState, player: Player, movesThisTurn: number, kingMoved: boolean): LegalActionSummary[] {
  const summaries: LegalActionSummary[] = [];
  for (let row = 0; row < board.config.rows; row += 1) {
    for (let col = 0; col < board.config.cols; col += 1) {
      const piece = board.grid[row][col];
      if (!piece || piece.player !== player) {
        continue;
      }
      if (piece.type === "King" && kingMoved) {
        continue;
      }
      for (const dr of [-2, -1, 0, 1, 2]) {
        for (const dc of [-2, -1, 0, 1, 2]) {
          if (dr === 0 && dc === 0) {
            continue;
          }
          const end: Vec2 = [row + dr, col + dc];
          if (!inBounds(board, end)) {
            continue;
          }
          const action = buildAction(board, [row, col], end, { movesThisTurn, kingMoved, rulesVersion: 1 });
          if (!action.error) {
            summaries.push(actionSummary(action));
          }
        }
      }
    }
  }
  summaries.push(actionSummary({ kind: "pass", player, cost: 0, capture: false, endsTurn: true } as Action));
  return summaries.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

export function normalizeLegalActions(encoded: Array<Record<string, unknown>>): LegalActionSummary[] {
  return encoded.map((action) => actionSummary(normalizePythonAction(action))).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}
