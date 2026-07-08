import { beforeEach, describe, expect, it } from "vitest";
import { buildAction, createBoard, getPiece, setPiece, updateControl, type Vec2 } from "../engine";
import { DEFAULT_MATCH_CONFIG, type MatchConfig } from "../setup/matchConfig";
import { useGameStore } from "./gameStore";

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    },
  });
}

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
    installLocalStorage();
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
    useGameStore.getState().startManualPlacement({ seed: 77 });
    let state = useGameStore.getState();
    expect(state.phase.phase).toBe("placement");
    expect(state.currentPlacement).toEqual({ player: "Black", pieceType: "King" });

    useGameStore.getState().activateSquare([0, 8]);
    expect(useGameStore.getState().message).toContain("left half");

    useGameStore.getState().activateSquare([0, 0]);
    state = useGameStore.getState();
    expect(getPiece(state.board, [0, 0])).toEqual({ player: "Black", type: "King" });
    expect(state.currentPlacement).toEqual({ player: "White", pieceType: "King" });
    expect(state.history).toHaveLength(1);
  });

  it("saves and reloads manual placement progress", () => {
    useGameStore.getState().startManualPlacement({ seed: 77 });
    useGameStore.getState().activateSquare([5, 2]);
    useGameStore.getState().saveGame();

    useGameStore.getState().startQuickMatch({ seed: 11 });
    useGameStore.getState().loadGame();

    const loaded = useGameStore.getState();
    expect(loaded.phase.phase).toBe("placement");
    expect(loaded.placementCursor).toBe(1);
    expect(loaded.currentPlacement).toEqual({ player: "White", pieceType: "King" });
    expect(getPiece(loaded.board, [5, 2])).toEqual({ player: "Black", type: "King" });
    expect(loaded.piecesLeft.Black.King).toBe(0);
    expect(loaded.matchConfig?.placementMode).toBe("Manual");
    expect(loaded.message).toBe("Game loaded.");
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
    expect(useGameStore.getState().pendingTransform).toMatchObject({ owner: "Black", player: "Black", pieceType: "AttackPawn", forceTurnSwitch: true });

    useGameStore.getState().chooseTransform("DefensePawn");
    const after = useGameStore.getState();
    expect(getPiece(after.board, [5, 6])).toEqual({ player: "Black", type: "DefensePawn" });
    expect(after.currentPlayer).toBe("White");
    expect(after.turnCounter).toBe(1);
    expect(after.phase.phase).toBe("playing");
  });

  it("counts down the active player clock with monotonic ticks and ends on timeout", () => {
    useGameStore.getState().startConfiguredMatch({
      ...DEFAULT_MATCH_CONFIG,
      placementMode: "QuickBalanced",
      timerSeconds: 300,
      setupSeed: 31,
    });

    useGameStore.getState().startClock(1000);
    useGameStore.getState().tickClock(3500);

    let state = useGameStore.getState();
    expect(state.timeLeft.Black).toBe(298);
    expect(state.timeLeft.White).toBe(300);
    expect(state.phase.phase).toBe("playing");

    useGameStore.getState().tickClock(302000);
    state = useGameStore.getState();
    expect(state.timeLeft.Black).toBe(0);
    expect(state.phase.phase).toBe("gameOver");
    expect(state.message).toBe("White wins by timeout.");
    expect(state.lastAction).toBe("Black ran out of time.");
  });

  it("does not run clocks for untimed matches or AI-owned turns", () => {
    useGameStore.getState().startConfiguredMatch({
      ...DEFAULT_MATCH_CONFIG,
      opponent: "Computer",
      humanSide: "Black",
      placementMode: "QuickBalanced",
      timerSeconds: 0,
      setupSeed: 32,
    });

    useGameStore.getState().startClock(1000);
    useGameStore.getState().tickClock(5000);
    expect(useGameStore.getState().timeLeft.Black).toBe(0);

    useGameStore.getState().startConfiguredMatch({
      ...DEFAULT_MATCH_CONFIG,
      opponent: "Computer",
      humanSide: "White",
      placementMode: "QuickBalanced",
      timerSeconds: 300,
      setupSeed: 33,
    });

    expect(useGameStore.getState().currentPlayer).toBe("Black");
    expect(useGameStore.getState().aiPlayer).toBe("Black");
    useGameStore.getState().startClock(1000);
    useGameStore.getState().tickClock(5000);
    expect(useGameStore.getState().timeLeft.Black).toBe(300);
  });

  it("shows a Defended-King preview before resolving a single-defender sacrifice", () => {
    const board = createBoard();
    setPiece(board, [5, 1], { player: "Black", type: "AttackPawn" });
    setPiece(board, [10, 1], { player: "Black", type: "King" });
    setPiece(board, [5, 3], { player: "White", type: "King" });
    setPiece(board, [4, 3], { player: "White", type: "DefensePawn" });
    updateControl(board);

    useGameStore.setState({
      phase: { phase: "playing" },
      board,
      currentPlayer: "Black",
      movesThisTurn: 0,
      kingMoved: false,
      selected: null,
      legalTargets: [],
      history: [],
      pendingTransform: null,
      pendingDefendedKing: null,
      aiEnabled: false,
      aiPlayer: "White",
    });

    useGameStore.getState().activateSquare([5, 1]);
    useGameStore.getState().activateSquare([5, 3]);

    const preview = useGameStore.getState();
    expect(preview.phase.phase).toBe("defenderSelection");
    expect(preview.pendingDefendedKing?.owner).toBe("White");
    expect(preview.pendingDefendedKing?.defenders).toEqual([[4, 3]]);
    expect(preview.legalTargets).toEqual([[4, 3]]);
    expect(preview.message).toContain("confirm the highlighted Defense Pawn sacrifice");

    useGameStore.getState().chooseDefender([4, 3]);
    const resolved = useGameStore.getState();
    expect(resolved.phase.phase).toBe("playing");
    expect(resolved.currentPlayer).toBe("White");
    expect(getPiece(resolved.board, [5, 0])).toEqual({ player: "Black", type: "AttackPawn" });
    expect(getPiece(resolved.board, [4, 3])).toBeNull();
    expect(resolved.board.capturedPieces.White.DefensePawn).toBe(1);
  });

  it("lets AI resolve owned defended-King decisions by explicit owner", () => {
    const board = createBoard();
    setPiece(board, [5, 1], { player: "Black", type: "AttackPawn" });
    setPiece(board, [10, 1], { player: "Black", type: "King" });
    setPiece(board, [5, 3], { player: "White", type: "King" });
    setPiece(board, [4, 3], { player: "White", type: "DefensePawn" });
    updateControl(board);

    useGameStore.setState({
      phase: { phase: "playing" },
      board,
      currentPlayer: "Black",
      movesThisTurn: 0,
      kingMoved: false,
      selected: null,
      legalTargets: [],
      history: [],
      pendingTransform: null,
      pendingDefendedKing: null,
      aiEnabled: true,
      aiPlayer: "White",
    });

    useGameStore.getState().activateSquare([5, 1]);
    useGameStore.getState().activateSquare([5, 3]);
    expect(useGameStore.getState().pendingDefendedKing?.owner).toBe("White");

    useGameStore.getState().runAiTurn();
    const resolved = useGameStore.getState();
    expect(resolved.phase.phase).toBe("playing");
    expect(resolved.pendingDefendedKing).toBeNull();
    expect(getPiece(resolved.board, [4, 3])).toBeNull();
    expect(resolved.board.capturedPieces.White.DefensePawn).toBe(1);
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

  it("resolves Random human side deterministically from the setup seed", () => {
    const config: MatchConfig = {
      ...DEFAULT_MATCH_CONFIG,
      opponent: "Computer",
      humanSide: "Random",
      placementMode: "QuickBalanced",
      timerSeconds: 300,
      setupSeed: 12345,
    };

    useGameStore.getState().startConfiguredMatch(config);
    const first = useGameStore.getState().matchConfig;
    useGameStore.getState().startConfiguredMatch(config);
    const second = useGameStore.getState().matchConfig;

    expect(first?.resolvedHumanSide).toBe(second?.resolvedHumanSide);
    expect(first?.aiSide).toBe(second?.aiSide);
    expect(first?.setupSeed).toBe(12345);
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
