import { beforeEach, describe, expect, it } from "vitest";
import { buildAction, createBoard, getPiece, setPiece, updateControl, type Vec2 } from "../engine";
import { DEFAULT_MATCH_CONFIG, type MatchConfig } from "../setup/matchConfig";
import { useGameStore } from "./gameStore";

function findFirstLegalMove(): { start: Vec2; end: Vec2 } {
  const state = useGameStore.getState();
  for (let row = 0; row < state.board.config.rows; row += 1) {
    for (let col = 0; col < state.board.config.cols; col += 1) {
      const piece = state.board.grid[row][col];
      if (!piece || piece.player !== state.currentPlayer) {
        continue;
      }
      const start: Vec2 = [row, col];
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          const end: Vec2 = [row + dr, col + dc];
          if (!buildAction(state.board, start, end, { movesThisTurn: state.movesThisTurn, kingMoved: state.kingMoved }).error) {
            return { start, end };
          }
        }
      }
    }
  }
  throw new Error("No legal move found");
}

describe("game store wiring", () => {
  beforeEach(() => {
    useGameStore.getState().startQuickMatch();
  });

  it("starts a quick match with a full deployment and applies an engine move", () => {
    const state = useGameStore.getState();
    expect(state.phase.phase).toBe("playing");
    expect(state.board.grid.flat().filter(Boolean)).toHaveLength(26);

    const { start, end } = findFirstLegalMove();
    const movingPiece = getPiece(state.board, start);
    useGameStore.getState().activateSquare(start);
    expect(useGameStore.getState().selected).toEqual(start);
    expect(useGameStore.getState().legalTargets.length).toBeGreaterThan(0);

    useGameStore.getState().activateSquare(end);
    const after = useGameStore.getState();
    expect(getPiece(after.board, end)).toEqual(movingPiece);
    expect(after.selected).toBeNull();
    expect(after.history).toHaveLength(1);
  });

  it("undo restores the previous board and turn state", () => {
    const before = useGameStore.getState();
    const { start, end } = findFirstLegalMove();
    useGameStore.getState().activateSquare(start);
    useGameStore.getState().activateSquare(end);
    useGameStore.getState().undo();
    const afterUndo = useGameStore.getState();
    expect(afterUndo.currentPlayer).toBe(before.currentPlayer);
    expect(afterUndo.movesThisTurn).toBe(before.movesThisTurn);
    expect(getPiece(afterUndo.board, start)).toEqual(getPiece(before.board, start));
  });

  it("manual placement uses the canonical placement queue and validates squares", () => {
    useGameStore.getState().startManualPlacement();
    let state = useGameStore.getState();
    expect(state.phase.phase).toBe("placement");
    expect(state.currentPlacement).toEqual({ player: "Black", pieceType: "King" });

    useGameStore.getState().activateSquare([5, 8]);
    expect(useGameStore.getState().message).toContain("left half");

    useGameStore.getState().activateSquare([5, 2]);
    state = useGameStore.getState();
    expect(getPiece(state.board, [5, 2])).toEqual({ player: "Black", type: "King" });
    expect(state.currentPlacement).toEqual({ player: "White", pieceType: "King" });
    expect(state.history).toHaveLength(1);
  });

  it("advances half-turn territory claims through the opponent response window", () => {
    const board = createBoard();
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
    setPiece(board, [10, 1], { player: "Black", type: "King" });
    setPiece(board, [10, 10], { player: "White", type: "King" });
    updateControl(board);

    useGameStore.setState({
      phase: { phase: "playing" },
      board,
      currentPlayer: "Black",
      movesThisTurn: 0,
      kingMoved: false,
      turnCounter: 0,
      selected: null,
      legalTargets: [],
      history: [],
      pendingTransform: null,
      pendingDefendedKing: null,
    });

    useGameStore.getState().passTurn();
    expect(useGameStore.getState().board.territoryClaim).toEqual({ claimant: "Black", createdTurn: 1, matureTurn: 3 });
    useGameStore.getState().passTurn();
    expect(useGameStore.getState().phase.phase).toBe("playing");
    useGameStore.getState().passTurn();
    expect(useGameStore.getState().phase.phase).toBe("gameOver");
    expect(useGameStore.getState().message).toContain("territory");
  });

  it("prompts and applies pawn transformation when a pawn lands on the Transform Square", () => {
    const board = createBoard({ transformEnabled: true });
    board.transformSquares = [[5, 6]];
    setPiece(board, [5, 5], { player: "Black", type: "AttackPawn" });
    setPiece(board, [10, 1], { player: "Black", type: "King" });
    setPiece(board, [10, 10], { player: "White", type: "King" });
    updateControl(board);

    useGameStore.setState({
      phase: { phase: "playing" },
      board,
      currentPlayer: "Black",
      movesThisTurn: 0,
      kingMoved: false,
      turnCounter: 0,
      selected: null,
      legalTargets: [],
      history: [],
      pendingTransform: null,
      pendingDefendedKing: null,
    });

    useGameStore.getState().activateSquare([5, 5]);
    useGameStore.getState().activateSquare([5, 6]);
    expect(useGameStore.getState().phase.phase).toBe("transformSelection");
    expect(useGameStore.getState().pendingTransform).toMatchObject({ player: "Black", pieceType: "AttackPawn", forceTurnSwitch: true });

    useGameStore.getState().chooseTransform("DefensePawn");
    const after = useGameStore.getState();
    expect(getPiece(after.board, [5, 6])).toEqual({ player: "Black", type: "DefensePawn" });
    expect(after.currentPlayer).toBe("White");
    expect(after.turnCounter).toBe(1);
    expect(after.phase.phase).toBe("playing");
  });

  it("runs a wired AI action through the engine", () => {
    useGameStore.getState().startAiMatch();
    useGameStore.setState({ currentPlayer: "White" });
    useGameStore.getState().runAiTurn();
    const after = useGameStore.getState();
    expect(after.aiEnabled).toBe(true);
    expect(after.history.length).toBeGreaterThan(0);
    expect(after.lastAction).not.toBe("Quick Balanced deployment complete.");
  });

  it("starts a configured computer quick match with AI as Black", () => {
    const config: MatchConfig = {
      ...DEFAULT_MATCH_CONFIG,
      opponent: "Computer",
      humanSide: "White",
      aiDifficulty: "Hard",
      placementMode: "QuickBalanced",
      transformEnabled: true,
      timerSeconds: 300,
      setupSeed: 44,
    };

    useGameStore.getState().startConfiguredMatch(config);
    const state = useGameStore.getState();

    expect(state.phase.phase).toBe("playing");
    expect(state.aiEnabled).toBe(true);
    expect(state.aiPlayer).toBe("Black");
    expect(state.matchConfig).toMatchObject({
      opponent: "Computer",
      humanSide: "White",
      resolvedHumanSide: "White",
      aiSide: "Black",
      aiDifficulty: "Hard",
      placementMode: "QuickBalanced",
      transformEnabled: true,
      timerSeconds: 300,
    });
    expect(state.timeLeft).toEqual({ Black: 300, White: 300 });
    expect(state.board.grid.flat().filter(Boolean)).toHaveLength(26);
  });

  it("lets AI own its manual placement schedule segment", () => {
    useGameStore.getState().startConfiguredMatch({
      ...DEFAULT_MATCH_CONFIG,
      opponent: "Computer",
      humanSide: "Black",
      placementMode: "Manual",
      setupSeed: 91,
    });

    useGameStore.getState().activateSquare([5, 2]);
    expect(useGameStore.getState().currentPlacement).toEqual({ player: "White", pieceType: "King" });

    useGameStore.getState().activateSquare([5, 9]);
    expect(useGameStore.getState().message).toContain("Computer is placing King");

    useGameStore.getState().runAiTurn();
    expect(useGameStore.getState().currentPlacement).toEqual({ player: "White", pieceType: "AttackPawn" });

    useGameStore.getState().runAiTurn();
    const afterAiPlacementSegment = useGameStore.getState();
    expect(afterAiPlacementSegment.currentPlacement).toEqual({ player: "Black", pieceType: "AttackPawn" });
    expect(afterAiPlacementSegment.history).toHaveLength(3);
    expect(afterAiPlacementSegment.board.grid.flat().filter(Boolean)).toHaveLength(3);
  });
});
