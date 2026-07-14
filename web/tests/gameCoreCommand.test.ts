import { describe, expect, it } from "vitest";
import {
  applyCommand,
  countPlacedPieces,
  createBoard,
  createMatch,
  deserializeState,
  getLegalActions,
  getPiece,
  serializeState,
  setPiece,
  updateControl,
  validateState,
  type BoardState,
  type MatchState,
} from "../../packages/game-core/src/index.js";

function playingState(board: BoardState, overrides: Partial<MatchState> = {}): MatchState {
  return {
    rulesVersion: 2,
    seed: 0,
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

function boardWithKings(): BoardState {
  const board = createBoard();
  setPiece(board, [10, 1], { player: "Black", type: "King" });
  setPiece(board, [10, 10], { player: "White", type: "King" });
  updateControl(board);
  return board;
}

describe("pure game-core command API", () => {
  it("creates deterministic quick and manual matches", () => {
    const quick = createMatch({ placementMode: "QuickBalanced", transformEnabled: true, seed: 17 });
    expect(quick.phase).toBe("playing");
    expect(quick.currentPlayer).toBe("Black");
    expect(countPlacedPieces(quick.board)).toBe(26);

    const manual = createMatch({ placementMode: "Manual", seed: 77 });
    expect(manual.phase).toBe("placement");
    expect(manual.currentPlacement).toEqual({ player: "Black", pieceType: "King" });
    expect(countPlacedPieces(manual.board)).toBe(0);
  });

  it("validates and advances manual placement without mutating the input", () => {
    const initial = createMatch({ placementMode: "Manual", seed: 77 });
    const result = applyCommand(initial, { type: "PlacePiece", position: [0, 0] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(initial.placementCursor).toBe(0);
    expect(getPiece(initial.board, [0, 0])).toBeNull();
    expect(result.state.placementCursor).toBe(1);
    expect(result.state.currentPlacement).toEqual({ player: "White", pieceType: "King" });
    expect(getPiece(result.state.board, [0, 0])).toEqual({ player: "Black", type: "King" });

    const illegal = applyCommand(result.state, { type: "PlacePiece", position: [0, 1] });
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.error.code).toBe("illegal_placement");
  });

  it("submits legal actions and changes turn after the second action", () => {
    const board = boardWithKings();
    setPiece(board, [5, 5], { player: "Black", type: "AttackPawn" });
    const initial = playingState(board);
    expect(getLegalActions(initial).some((action) => action.kind === "pass")).toBe(true);

    const first = applyCommand(initial, { type: "SubmitAction", start: [5, 5], end: [5, 6] });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.currentPlayer).toBe("Black");
    expect(first.state.movesThisTurn).toBe(1);

    const second = applyCommand(first.state, { type: "SubmitAction", start: [5, 6], end: [5, 7] });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.currentPlayer).toBe("White");
    expect(second.state.movesThisTurn).toBe(0);
    expect(second.state.turnCounter).toBe(1);
  });

  it("represents and resolves Defended King as an explicit pending decision", () => {
    const board = createBoard();
    setPiece(board, [5, 1], { player: "Black", type: "AttackPawn" });
    setPiece(board, [10, 1], { player: "Black", type: "King" });
    setPiece(board, [5, 3], { player: "White", type: "King" });
    setPiece(board, [4, 3], { player: "White", type: "DefensePawn" });
    updateControl(board);

    const pending = applyCommand(playingState(board), {
      type: "SubmitAction",
      start: [5, 1],
      end: [5, 3],
    });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.state.phase).toBe("defenderSelection");
    expect(pending.state.pendingDefendedKing?.defenders).toEqual([[4, 3]]);
    expect(getPiece(pending.state.board, [4, 3])).toEqual({ player: "White", type: "DefensePawn" });

    const resolved = applyCommand(pending.state, { type: "ChooseDefender", position: [4, 3] });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.phase).toBe("playing");
    expect(resolved.state.currentPlayer).toBe("White");
    expect(getPiece(resolved.state.board, [4, 3])).toBeNull();
    expect(resolved.state.board.capturedPieces.White.DefensePawn).toBe(1);
  });

  it("rejects stale decisions and supports cancelling Defended King", () => {
    const state = playingState(boardWithKings());
    const stale = applyCommand(state, { type: "ChooseDefender", position: [0, 0] });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("wrong_phase");

    const board = createBoard();
    setPiece(board, [5, 1], { player: "Black", type: "AttackPawn" });
    setPiece(board, [10, 1], { player: "Black", type: "King" });
    setPiece(board, [5, 3], { player: "White", type: "King" });
    setPiece(board, [4, 3], { player: "White", type: "DefensePawn" });
    updateControl(board);
    const pending = applyCommand(playingState(board), {
      type: "SubmitAction",
      start: [5, 1],
      end: [5, 3],
    });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    const cancelled = applyCommand(pending.state, { type: "CancelDefendedKing" });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.state.phase).toBe("playing");
    expect(cancelled.state.pendingDefendedKing).toBeNull();
    expect(cancelled.state.board).toEqual(state.board === board ? state.board : board);
  });

  it("charges Transform as the second action and then changes turn", () => {
    const board = createBoard({ transformEnabled: true });
    board.transformSquares = [[5, 6]];
    setPiece(board, [5, 5], { player: "Black", type: "AttackPawn" });
    setPiece(board, [10, 1], { player: "Black", type: "King" });
    setPiece(board, [10, 10], { player: "White", type: "King" });
    updateControl(board);

    const pending = applyCommand(playingState(board), {
      type: "SubmitAction",
      start: [5, 5],
      end: [5, 6],
    });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.state.phase).toBe("transformSelection");
    expect(pending.state.pendingTransform).toMatchObject({
      owner: "Black",
      pieceType: "AttackPawn",
      forceTurnSwitch: false,
    });
    expect(pending.state.movesThisTurn).toBe(1);

    const transformed = applyCommand(pending.state, { type: "ChooseTransform", newType: "DefensePawn" });
    expect(transformed.ok).toBe(true);
    if (!transformed.ok) return;
    expect(getPiece(transformed.state.board, [5, 6])).toEqual({ player: "Black", type: "DefensePawn" });
    expect(transformed.state.currentPlayer).toBe("White");
    expect(transformed.state.turnCounter).toBe(1);
    expect(transformed.state.movesThisTurn).toBe(0);
    expect(transformed.state.phase).toBe("playing");
  });

  it("declines an immediate Transform without spending the remaining action", () => {
    const board = boardWithKings();
    board.config.transformEnabled = true;
    board.transformSquares = [[5, 6]];
    setPiece(board, [5, 5], { player: "Black", type: "AttackPawn" });
    const landed = applyCommand(playingState(board), { type: "SubmitAction", start: [5, 5], end: [5, 6] });
    expect(landed.ok).toBe(true);
    if (!landed.ok) return;

    const declined = applyCommand(landed.state, { type: "DeclineTransform" });
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    expect(declined.state.phase).toBe("playing");
    expect(declined.state.movesThisTurn).toBe(1);
    expect(declined.state.currentPlayer).toBe("Black");
    expect(declined.state.board.transformSquares).toEqual([[5, 6]]);
    expect(getPiece(declined.state.board, [5, 6])?.type).toBe("AttackPawn");
  });

  it("does not offer or consume Transform when landing uses the second action", () => {
    const board = boardWithKings();
    board.config.transformEnabled = true;
    board.transformSquares = [[5, 6]];
    setPiece(board, [5, 5], { player: "Black", type: "AttackPawn" });
    const landed = applyCommand(playingState(board, { movesThisTurn: 1 }), {
      type: "SubmitAction",
      start: [5, 5],
      end: [5, 6],
    });
    expect(landed.ok).toBe(true);
    if (!landed.ok) return;
    expect(landed.state.phase).toBe("playing");
    expect(landed.state.pendingTransform).toBeNull();
    expect(landed.state.currentPlayer).toBe("White");
    expect(landed.state.board.transformSquares).toEqual([[5, 6]]);
    expect(getPiece(landed.state.board, [5, 6])?.type).toBe("AttackPawn");
    expect(landed.transition?.events.some((event) => event.kind === "transform_available")).toBe(false);
  });

  it("allows a pawn left on Transform to activate it on a later turn for one action", () => {
    const board = boardWithKings();
    board.config.transformEnabled = true;
    board.transformSquares = [[5, 6]];
    setPiece(board, [5, 5], { player: "Black", type: "AttackPawn" });
    const landed = applyCommand(playingState(board, { movesThisTurn: 1 }), {
      type: "SubmitAction",
      start: [5, 5],
      end: [5, 6],
    });
    expect(landed.ok).toBe(true);
    if (!landed.ok) return;
    const whitePassed = applyCommand(landed.state, { type: "PassTurn" });
    expect(whitePassed.ok).toBe(true);
    if (!whitePassed.ok) return;
    const activated = applyCommand(whitePassed.state, { type: "ActivateTransform", position: [5, 6] });
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    const transformed = applyCommand(activated.state, { type: "ChooseTransform", newType: "ConquestPawn" });
    expect(transformed.ok).toBe(true);
    if (!transformed.ok) return;
    expect(transformed.state.currentPlayer).toBe("Black");
    expect(transformed.state.movesThisTurn).toBe(1);
    expect(getPiece(transformed.state.board, [5, 6])?.type).toBe("ConquestPawn");
    expect(transformed.state.board.transformSquares).not.toEqual([[5, 6]]);
  });

  it("can ignore a later-turn Transform or move away without relocating it", () => {
    const board = boardWithKings();
    board.config.transformEnabled = true;
    board.transformSquares = [[5, 6]];
    setPiece(board, [5, 6], { player: "Black", type: "AttackPawn" });
    const state = playingState(board);
    const activated = applyCommand(state, { type: "ActivateTransform", position: [5, 6] });
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    const declined = applyCommand(activated.state, { type: "DeclineTransform" });
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    expect(declined.state.movesThisTurn).toBe(0);
    expect(declined.state.board.transformSquares).toEqual([[5, 6]]);

    const moved = applyCommand(declined.state, { type: "SubmitAction", start: [5, 6], end: [5, 7] });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.state.board.transformSquares).toEqual([[5, 6]]);
    expect(getPiece(moved.state.board, [5, 7])?.type).toBe("AttackPawn");
  });

  it("rejects Transform with no action token and rejects stale decline or activation", () => {
    const board = boardWithKings();
    board.config.transformEnabled = true;
    board.transformSquares = [[5, 6]];
    setPiece(board, [5, 6], { player: "Black", type: "AttackPawn" });
    const pending = {
      owner: "Black" as const,
      player: "Black" as const,
      pos: [5, 6] as [number, number],
      pieceType: "AttackPawn" as const,
      forceTurnSwitch: false,
    };
    const noToken = applyCommand(playingState(board, { phase: "transformSelection", movesThisTurn: 2, pendingTransform: pending }), {
      type: "ChooseTransform",
      newType: "DefensePawn",
    });
    expect(noToken.ok).toBe(false);
    if (!noToken.ok) expect(noToken.error.message).toContain("No action token");

    const staleDecline = applyCommand(playingState(board), { type: "DeclineTransform" });
    expect(staleDecline.ok).toBe(false);
    const wrongSquare = applyCommand(playingState(board), { type: "ActivateTransform", position: [5, 5] });
    expect(wrongSquare.ok).toBe(false);
    const noTokenActivation = applyCommand(playingState(board, { movesThisTurn: 2 }), {
      type: "ActivateTransform",
      position: [5, 6],
    });
    expect(noTokenActivation.ok).toBe(false);
  });

  it("matures territory through server-style PassTurn commands", () => {
    const board = boardWithKings();
    board.specialSquares = [
      [1, 1],
      [1, 4],
      [4, 1],
      [4, 4],
      [7, 7],
    ];
    setPiece(board, [1, 1], { player: "Black", type: "ConquestPawn" });
    setPiece(board, [1, 4], { player: "Black", type: "ConquestPawn" });
    setPiece(board, [4, 1], { player: "Black", type: "ConquestPawn" });
    updateControl(board);

    const first = applyCommand(playingState(board), { type: "PassTurn" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.board.territoryClaim).toEqual({ claimant: "Black", createdTurn: 1, matureTurn: 3 });
    const second = applyCommand(first.state, { type: "PassTurn" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const third = applyCommand(second.state, { type: "PassTurn" });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.state.phase).toBe("gameOver");
    expect(third.state.victory).toMatchObject({ winner: "Black", reason: "territory" });
  });

  it("serializes, validates and restores canonical match state in plain data", () => {
    const state = createMatch({ placementMode: "QuickBalanced", transformEnabled: true, seed: 42 });
    const raw = serializeState(state);
    const parsed: unknown = JSON.parse(raw);
    expect(validateState(parsed)).toBe(true);
    const restored = deserializeState(raw);
    expect(restored).not.toBeNull();
    expect(restored).toEqual(state);
    expect(deserializeState("{bad json")).toBeNull();
  });
});
