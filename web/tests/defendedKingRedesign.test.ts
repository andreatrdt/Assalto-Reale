import { describe, expect, it } from "vitest";
import {
  applyCommand,
  buildAction,
  cheb,
  createBoard,
  generateTransformSquare,
  getDefendedKingPreviewFromPositions,
  getLegalActions,
  getPiece,
  pieceIdAt,
  setPiece,
  transformPiece,
  type BoardState,
  type MatchState,
  type Vec2,
} from "../../packages/game-core/src/index.js";

function state(board: BoardState, overrides: Partial<MatchState> = {}): MatchState {
  return {
    rulesVersion: 2,
    seed: 17,
    board,
    phase: "playing",
    currentPlayer: "Black",
    movesThisTurn: 0,
    kingMoved: false,
    turnCounter: 0,
    placementCursor: 26,
    currentPlacement: null,
    piecesLeft: {
      Black: { King: 0, AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0 },
      White: { King: 0, AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0 },
    },
    pendingDefendedKing: null,
    pendingTransform: null,
    victory: null,
    ...overrides,
  };
}

function defendedBoard(attacker: Vec2 = [5, 5], king: Vec2 = [5, 6], defender: Vec2 = [4, 6]): BoardState {
  const board = createBoard();
  setPiece(board, [11, 11], { player: "Black", type: "King" });
  setPiece(board, attacker, { player: "Black", type: "AttackPawn" });
  setPiece(board, king, { player: "White", type: "King" });
  setPiece(board, defender, { player: "White", type: "DefensePawn" });
  return board;
}

describe("rules-v2 Defended King redesign", () => {
  it.each([
    { direction: "left", attacker: [5, 3], defender: [5, 4], king: [5, 5] },
    { direction: "right", attacker: [5, 7], defender: [5, 6], king: [5, 5] },
    { direction: "above", attacker: [3, 5], defender: [4, 5], king: [5, 5] },
    { direction: "below", attacker: [7, 5], defender: [6, 5], king: [5, 5] },
  ] as const)("offers the King through its $direction path defender", ({ attacker, defender, king }) => {
    const board = defendedBoard(attacker, king, defender);
    const direct = buildAction(board, attacker, king);
    expect(direct.error).toBeFalsy();
    expect(direct.defendedKing?.pathDefenderId).toBe(pieceIdAt(board, defender));

    const targets = getLegalActions(state(board)).filter(
      (action) => action.start?.[0] === attacker[0] && action.start?.[1] === attacker[1],
    );
    expect(targets.some((action) => action.end?.[0] === king[0] && action.end?.[1] === king[1])).toBe(true);
    expect(targets.some((action) => action.end?.[0] === defender[0] && action.end?.[1] === defender[1])).toBe(false);

    const bypass = buildAction(board, attacker, defender);
    expect(bypass.error).toContain("path defender");
  });

  it("attacks through exactly one path defender, auto-sacrifices it, and removes the bypass capture", () => {
    const board = defendedBoard([5, 1], [5, 3], [5, 2]);
    const preview = getDefendedKingPreviewFromPositions(board, [5, 1], [5, 3], 0, 2);
    expect(preview?.pathDefenderId).toBe(pieceIdAt(board, [5, 2]));
    expect(preview?.eligibleDefenderIds).toEqual([pieceIdAt(board, [5, 2])]);

    const bypass = buildAction(board, [5, 1], [5, 2], { rulesVersion: 2 });
    expect(bypass.error).toContain("path defender");
    const result = applyCommand(state(board), { type: "SubmitAction", start: [5, 1], end: [5, 3] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pendingDefendedKing).toBeNull();
    expect(getPiece(result.state.board, [5, 2])).toBeNull();
    expect(getPiece(result.state.board, [5, 3])).toEqual({ player: "White", type: "King" });
  });

  it("does not grant a general jump and leaves ordinary Defense Pawn captures legal", () => {
    const board = defendedBoard([5, 1], [5, 4], [5, 2]);
    expect(buildAction(board, [5, 1], [5, 3], { rulesVersion: 2 }).error).toBeTruthy();
    expect(buildAction(board, [5, 1], [5, 2], { rulesVersion: 2 }).error).toBeFalsy();
  });

  it("does not enable the path attack for the wrong intervening piece or an over-range defender", () => {
    const wrongPiece = defendedBoard([5, 1], [5, 3], [4, 3]);
    setPiece(wrongPiece, [5, 2], { player: "White", type: "ConquestPawn" });
    expect(buildAction(wrongPiece, [5, 1], [5, 3]).error).toContain("intermediate square");

    const notAdjacent = defendedBoard([5, 1], [5, 4], [5, 2]);
    expect(buildAction(notAdjacent, [5, 1], [5, 4]).error).toBeTruthy();
  });

  it("rejects diagonal, over-range, late-turn, and multiply-blocked King attacks", () => {
    const diagonal = defendedBoard([5, 1], [6, 2], [6, 1]);
    expect(getDefendedKingPreviewFromPositions(diagonal, [5, 1], [6, 2], 0, 2)).toBeNull();
    const path = defendedBoard([5, 1], [5, 3], [5, 2]);
    expect(getDefendedKingPreviewFromPositions(path, [5, 1], [5, 3], 1, 2)).toBeNull();
    setPiece(path, [5, 0], { player: "White", type: "ConquestPawn" });
    expect(getDefendedKingPreviewFromPositions(path, [5, 0], [5, 3], 0, 2)).toBeNull();
  });

  it("keeps the legacy defender-choice mechanic when no defender is on the path", () => {
    const result = applyCommand(state(defendedBoard()), { type: "SubmitAction", start: [5, 5], end: [5, 6] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.pendingDefendedKing?.owner).toBe("White");
  });

  it("keeps an explicitly rules-v1 path defender blocked for replay compatibility", () => {
    const board = defendedBoard([5, 1], [5, 3], [5, 2]);
    expect(buildAction(board, [5, 1], [5, 3], { rulesVersion: 1 }).error).toContain("intermediate square");
    expect(getDefendedKingPreviewFromPositions(board, [5, 1], [5, 3], 0, 1)).toBeNull();
  });

  it("generates a clear five-square route and counts crossed jump squares", () => {
    const clear = getDefendedKingPreviewFromPositions(defendedBoard(), [5, 5], [5, 6], 0, 2)!;
    expect(clear.routes[0]?.path).toEqual([
      [5, 5],
      [5, 4],
      [5, 3],
      [5, 2],
      [5, 1],
    ]);
    const obstacle = defendedBoard();
    setPiece(obstacle, [5, 4], { player: "White", type: "ConquestPawn" });
    const jumped = getDefendedKingPreviewFromPositions(obstacle, [5, 5], [5, 6], 0, 2)!;
    expect(jumped.routes[0]?.jumpedSquares).toEqual([[5, 4]]);
    expect(jumped.routes[0]?.path).toHaveLength(5);
    expect(jumped.routes[0]?.landingPosition).toEqual([5, 1]);
  });

  it("jumps contiguous obstacles and resumes the primary direction", () => {
    const board = defendedBoard();
    setPiece(board, [5, 4], { player: "Black", type: "ConquestPawn" });
    setPiece(board, [5, 3], { player: "White", type: "ConquestPawn" });
    const preview = getDefendedKingPreviewFromPositions(board, [5, 5], [5, 6], 0, 2)!;
    expect(preview.routes[0]?.jumpedSquares).toEqual([
      [5, 4],
      [5, 3],
    ]);
    expect(preview.routes[0]?.path.at(-1)).toEqual([5, 1]);
  });

  it("returns clockwise and counter-clockwise bypass choices and validates the semantic route", () => {
    const board = defendedBoard();
    for (let col = 0; col <= 4; col += 1) setPiece(board, [5, col], { player: "White", type: "ConquestPawn" });
    const preview = getDefendedKingPreviewFromPositions(board, [5, 5], [5, 6], 0, 2)!;
    expect(preview.routes.map((route) => route.id)).toEqual(["clockwise", "counterClockwise"]);
    expect(preview.routes.every((route) => route.path.length <= 5)).toBe(true);

    const missingChoice = applyCommand(state(board), { type: "SubmitAction", start: [5, 5], end: [5, 6] });
    expect(missingChoice.ok).toBe(false);
    const selected = applyCommand(state(board), {
      type: "SubmitAction",
      start: [5, 5],
      end: [5, 6],
      routeId: "clockwise",
    });
    expect(selected.ok).toBe(true);
  });

  it("preserves the attacker origin when no displacement beyond it is legal", () => {
    const board = defendedBoard([0, 1], [0, 0], [1, 0]);
    for (let col = 2; col < 12; col += 1) setPiece(board, [0, col], { player: "White", type: "ConquestPawn" });
    for (let col = 1; col < 12; col += 1) setPiece(board, [1, col], { player: "White", type: "ConquestPawn" });
    const preview = getDefendedKingPreviewFromPositions(board, [0, 1], [0, 0], 0, 2)!;
    expect(preview.landingPosition).toEqual([0, 1]);
  });

  it("keeps rules-v1 blocked routing readable", () => {
    const board = defendedBoard();
    setPiece(board, [5, 4], { player: "White", type: "ConquestPawn" });
    const legacy = getDefendedKingPreviewFromPositions(board, [5, 5], [5, 6], 0, 1)!;
    expect(legacy.routes).toEqual([{ id: "primary", path: [[5, 5]], jumpedSquares: [], turnSquares: [], landingPosition: [5, 5] }]);
  });
});

describe("rules-v2 Transform relocation", () => {
  it("maximizes Chebyshev distance, then pawn distance, with seeded deterministic ties", () => {
    const board = createBoard({ transformEnabled: true });
    setPiece(board, [5, 5], { player: "Black", type: "AttackPawn" });
    setPiece(board, [5, 7], { player: "White", type: "AttackPawn" });
    const previous: Vec2 = [5, 5];
    board.transformSquares = [previous];
    const first = transformPiece(board, previous, "DefensePawn", 1234, 2);
    const second = transformPiece(board, previous, "DefensePawn", 1234, 2);
    const chosen = first.board.transformSquares[0]!;
    expect(second.board.transformSquares[0]).toEqual(chosen);
    expect(chosen).not.toEqual(previous);
    expect(getPiece(first.board, chosen)).toBeNull();
    expect(first.board.specialSquares).not.toContainEqual(chosen);

    const probe = createBoard({ transformEnabled: true });
    setPiece(probe, [5, 5], { player: "Black", type: "DefensePawn" });
    setPiece(probe, [5, 7], { player: "White", type: "AttackPawn" });
    generateTransformSquare(probe, 1234, { rulesVersion: 1 });
    const allLegacyLegal: Vec2[] = [];
    for (let seed = 0; seed < 1000; seed += 1) {
      const candidateBoard = createBoard({ transformEnabled: true });
      setPiece(candidateBoard, [5, 5], { player: "Black", type: "DefensePawn" });
      setPiece(candidateBoard, [5, 7], { player: "White", type: "AttackPawn" });
      generateTransformSquare(candidateBoard, seed, { rulesVersion: 1 });
      const candidate = candidateBoard.transformSquares[0];
      if (candidate && !allLegacyLegal.some((pos) => pos[0] === candidate[0] && pos[1] === candidate[1])) allLegacyLegal.push(candidate);
    }
    const maximum = Math.max(...allLegacyLegal.map((candidate) => cheb(candidate, previous)));
    expect(cheb(chosen, previous)).toBe(maximum);
  });
});
