import { describe, expect, it } from "vitest";
import { cloneBoard, createBoard, createPiece, setPiece, type BoardState, type Vec2 } from "../src/game/engine";
import { deriveBoardMotion, motionDuration, orientedPosition, squareDelta, type BoardMotionSnapshot } from "../src/board/boardMotion";

function snapshot(board: BoardState, overrides: Partial<BoardMotionSnapshot> = {}): BoardMotionSnapshot {
  return {
    board,
    phase: "playing",
    lastAction: "Black to move.",
    message: "Black to move.",
    placementCursor: 26,
    historyLength: 0,
    pendingTransform: null,
    pendingDefendedKing: null,
    ...overrides,
  };
}

describe("board coordinate mapping", () => {
  it("maps normal and flipped coordinates deterministically", () => {
    expect(orientedPosition([2, 3], 12, 12)).toEqual([2, 3]);
    expect(orientedPosition([2, 3], 12, 12, true)).toEqual([9, 8]);
  });

  it("reverses a movement delta when the board is flipped", () => {
    expect(squareDelta([5, 4], [5, 6], 100, 12, 12)).toEqual({ x: 200, y: 0 });
    expect(squareDelta([5, 4], [5, 6], 100, 12, 12, true)).toEqual({ x: -200, y: 0 });
  });
});

describe("deriveBoardMotion", () => {
  it("does not replay without a previous snapshot", () => {
    expect(deriveBoardMotion(null, snapshot(createBoard()))).toEqual({ event: null, reset: false });
  });

  it("derives an ordinary move from the authoritative board delta", () => {
    const before = createBoard();
    setPiece(before, [5, 4], createPiece("AttackPawn", "Black"));
    const after = cloneBoard(before);
    setPiece(after, [5, 4], null);
    setPiece(after, [5, 6], createPiece("AttackPawn", "Black"));

    expect(deriveBoardMotion(snapshot(before), snapshot(after, { lastAction: "Black moved to G7." })).event).toMatchObject({
      kind: "move",
      from: [5, 4],
      to: [5, 6],
      piece: { player: "Black", type: "AttackPawn" },
    });
  });

  it("derives a capture with the removed target piece", () => {
    const before = createBoard();
    setPiece(before, [5, 4], createPiece("AttackPawn", "Black"));
    setPiece(before, [5, 6], createPiece("DefensePawn", "White"));
    const after = cloneBoard(before);
    setPiece(after, [5, 4], null);
    setPiece(after, [5, 6], createPiece("AttackPawn", "Black"));

    expect(deriveBoardMotion(snapshot(before), snapshot(after, { lastAction: "Black captured Defense Pawn on G7." })).event).toMatchObject({
      kind: "capture",
      from: [5, 4],
      to: [5, 6],
      piece: { player: "Black", type: "AttackPawn" },
      captured: { player: "White", type: "DefensePawn" },
    });
  });

  it("derives a short placement settle", () => {
    const before = createBoard();
    const after = cloneBoard(before);
    setPiece(after, [5, 2], createPiece("King", "Black"));

    expect(
      deriveBoardMotion(
        snapshot(before, { phase: "placement", placementCursor: 2 }),
        snapshot(after, { phase: "placement", placementCursor: 3, lastAction: "Black placed King on C7." }),
      ).event,
    ).toMatchObject({ kind: "place", at: [5, 2], piece: { player: "Black", type: "King" } });
  });

  it("derives transformation only when the canonical piece type changes", () => {
    const before = createBoard({ transformEnabled: true });
    setPiece(before, [4, 4], createPiece("AttackPawn", "Black"));
    const after = cloneBoard(before);
    setPiece(after, [4, 4], createPiece("ConquestPawn", "Black"));

    const result = deriveBoardMotion(
      snapshot(before, { pendingTransform: { pos: [4, 4], pieceType: "AttackPawn" } }),
      snapshot(after, { lastAction: "Black transformed into Conquest Pawn on E8." }),
    );

    expect(result.event).toMatchObject({
      kind: "transform",
      at: [4, 4],
      fromPiece: { type: "AttackPawn" },
      toPiece: { type: "ConquestPawn" },
    });
  });

  it("derives the full defended-King attack, sacrifice and landing sequence", () => {
    const before = createBoard();
    setPiece(before, [5, 2], createPiece("AttackPawn", "Black"));
    setPiece(before, [5, 4], createPiece("King", "White"));
    setPiece(before, [4, 4], createPiece("DefensePawn", "White"));
    const after = cloneBoard(before);
    setPiece(after, [5, 2], null);
    setPiece(after, [4, 4], null);
    setPiece(after, [5, 1], createPiece("AttackPawn", "Black"));

    const result = deriveBoardMotion(
      snapshot(before, {
        phase: "defenderSelection",
        pendingDefendedKing: {
          action: {
            start: [5, 2],
            end: [5, 4],
            defendedKing: { landingPosition: [5, 1] },
          },
          defenders: [[4, 4]],
        },
      }),
      snapshot(after, { lastAction: "Black attacked a defended King; Attack Pawn bounced to B7." }),
    );

    expect(result.event).toMatchObject({
      kind: "defendedKing",
      from: [5, 2],
      king: [5, 4],
      sacrifice: [4, 4],
      landing: [5, 1],
      piece: { player: "Black", type: "AttackPawn" },
      sacrificedPiece: { player: "White", type: "DefensePawn" },
    });
  });

  it("derives an AI-confirmed defended-King sequence without a pending selection snapshot", () => {
    const before = createBoard();
    setPiece(before, [5, 2], createPiece("AttackPawn", "Black"));
    setPiece(before, [5, 4], createPiece("King", "White"));
    setPiece(before, [4, 4], createPiece("DefensePawn", "White"));
    const after = cloneBoard(before);
    setPiece(after, [5, 2], null);
    setPiece(after, [4, 4], null);
    setPiece(after, [5, 1], createPiece("AttackPawn", "Black"));

    expect(
      deriveBoardMotion(snapshot(before), snapshot(after, { lastAction: "Black attacked a defended King; Attack Pawn bounced to B7." }))
        .event,
    ).toMatchObject({ kind: "defendedKing", king: [5, 4], sacrifice: [4, 4], landing: [5, 1] });
  });

  it("animates the exact authoritative route when alternatives share a landing", () => {
    const before = createBoard();
    setPiece(before, [5, 2], createPiece("AttackPawn", "Black"));
    setPiece(before, [5, 4], createPiece("King", "White"));
    setPiece(before, [4, 4], createPiece("DefensePawn", "White"));
    const after = cloneBoard(before);
    setPiece(after, [5, 2], null);
    setPiece(after, [4, 4], null);
    setPiece(after, [5, 0], createPiece("AttackPawn", "Black"));

    const clockwise = {
      id: "clockwise" as const,
      path: [
        [4, 4],
        [4, 3],
        [5, 3],
        [5, 2],
        [5, 0],
      ] as Vec2[],
      jumpedSquares: [] as Vec2[],
      turnSquares: [[4, 4]] as Vec2[],
      landingPosition: [5, 0] as const,
    };
    const counterClockwise = {
      id: "counterClockwise" as const,
      path: [
        [6, 4],
        [6, 3],
        [5, 3],
        [5, 2],
        [5, 0],
      ] as Vec2[],
      jumpedSquares: [[5, 1]] as Vec2[],
      turnSquares: [[6, 4]] as Vec2[],
      landingPosition: [5, 0] as const,
    };

    const result = deriveBoardMotion(
      snapshot(before, { rulesVersion: 2 }),
      snapshot(after, {
        rulesVersion: 2,
        lastAction: "Black attacked a defended King; Attack Pawn bounced to A7.",
        resolvedDefendedKing: {
          action: {
            start: [5, 2],
            end: [5, 4],
            defendedKing: {
              landingPosition: [5, 0],
              selectedRouteId: "counterClockwise",
              routes: [clockwise, counterClockwise],
            },
          },
          defenders: [[4, 4]],
        },
      }),
    );

    expect(result.event).toMatchObject({
      kind: "defendedKing",
      route: counterClockwise.path,
      jumpedSquares: counterClockwise.jumpedSquares,
      turnSquares: counterClockwise.turnSquares,
    });
  });

  it("cancels transient work for undo and restored-state transitions", () => {
    const before = createBoard();
    setPiece(before, [5, 4], createPiece("AttackPawn", "Black"));
    const after = cloneBoard(before);
    setPiece(after, [5, 4], null);
    setPiece(after, [5, 6], createPiece("AttackPawn", "Black"));

    expect(deriveBoardMotion(snapshot(before, { historyLength: 2 }), snapshot(after, { historyLength: 1, message: "Undone." }))).toEqual({
      event: null,
      reset: true,
    });
  });
});

describe("motionDuration", () => {
  it("keeps reduced motion immediate and special sequences bounded", () => {
    expect(motionDuration("move", true)).toBe(80);
    expect(motionDuration("move", false)).toBe(220);
    expect(motionDuration("capture", false)).toBeLessThanOrEqual(280);
    expect(motionDuration("defendedKing", false)).toBeLessThanOrEqual(500);
  });
});
