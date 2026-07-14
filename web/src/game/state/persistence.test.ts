import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAction,
  chooseQuickPlacementSquare,
  createBoard,
  getPiece,
  setPiece,
  updateControl,
  type BoardState,
  type Vec2,
} from "../engine";
import { DEFAULT_MATCH_CONFIG, type MatchConfig } from "../setup/matchConfig";
import { useGameStore } from "./gameStore";

// --- test doubles for localStorage -----------------------------------------

function installLocalStorage(store = new Map<string, string>()) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
      },
    },
  });
  return store;
}

function installThrowingLocalStorage() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException("QuotaExceededError");
        },
        removeItem: () => undefined,
      },
    },
  });
}

function removeLocalStorage() {
  Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
}

// --- helpers ----------------------------------------------------------------

const s = () => useGameStore.getState();

// Drive the real manual-placement flow to completion so the store reaches the
// playing phase exactly as production does — there is no quick deployment.
function completePlacement(): void {
  for (let guard = 0; guard < 64; guard += 1) {
    const state = s();
    if (state.phase.phase !== "placement" || !state.currentPlacement) break;
    const { player, pieceType } = state.currentPlacement;
    if (state.aiEnabled && player === state.aiPlayer) {
      s().runAiTurn();
    } else {
      s().activateSquare(chooseQuickPlacementSquare(state.board, player, pieceType));
    }
  }
}

// Start a match through the public configured flow and finish placement, leaving
// the store in the playing phase with a full board. Placement is recorded in
// history; clear it so gameplay/persistence tests start from a clean playing slate.
function startPlayingMatch(config: Partial<MatchConfig> = {}): void {
  s().startConfiguredMatch({ ...DEFAULT_MATCH_CONFIG, ...config });
  completePlacement();
  useGameStore.setState({ history: [] });
}

/** Round-trip through the real export → (disturb) → import path and return the restored state. */
function exportDisturbImport(): boolean {
  const exported = s().exportSaveJson();
  // Disturb the store so a naive comparison cannot pass without a real restore.
  startPlayingMatch({ setupSeed: 999 });
  return s().importSaveJson(exported ?? "");
}

function findFirstLegalMove(): { start: Vec2; end: Vec2 } {
  const state = s();
  for (let row = 0; row < state.board.config.rows; row += 1) {
    for (let col = 0; col < state.board.config.cols; col += 1) {
      const piece = state.board.grid[row][col];
      if (!piece || piece.player !== state.currentPlayer) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          const start: Vec2 = [row, col];
          const end: Vec2 = [row + dr, col + dc];
          if (!buildAction(state.board, start, end, { movesThisTurn: state.movesThisTurn, kingMoved: state.kingMoved }).error) {
            return { start, end };
          }
        }
      }
    }
  }
  throw new Error("no legal move");
}

function setScenario(board: BoardState, overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  });
}

function defendedKingScenario() {
  const board = createBoard();
  setPiece(board, [5, 1], { player: "Black", type: "AttackPawn" });
  setPiece(board, [10, 1], { player: "Black", type: "King" });
  setPiece(board, [5, 3], { player: "White", type: "King" });
  setPiece(board, [4, 3], { player: "White", type: "DefensePawn" });
  updateControl(board);
  return board;
}

function transformScenario() {
  const board = createBoard({ transformEnabled: true });
  board.transformSquares = [[5, 6]];
  setPiece(board, [5, 5], { player: "Black", type: "AttackPawn" });
  setPiece(board, [10, 1], { player: "Black", type: "King" });
  setPiece(board, [10, 10], { player: "White", type: "King" });
  updateControl(board);
  return board;
}

function territoryScenario() {
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
  return board;
}

beforeEach(() => {
  installLocalStorage();
  startPlayingMatch({ setupSeed: 7 });
});

afterEach(() => {
  removeLocalStorage();
});

// --- Phase 3/4: round-trip + continuation ----------------------------------

describe("persistence round-trip across match phases", () => {
  it("restores manual placement mid-schedule and continues placing", () => {
    s().startManualPlacement({ seed: 77 });
    s().activateSquare([0, 0]); // Black King
    const before = s();
    expect(before.placementCursor).toBe(1);

    expect(exportDisturbImport()).toBe(true);
    const after = s();
    expect(after.phase.phase).toBe("placement");
    expect(after.placementCursor).toBe(1);
    expect(after.currentPlacement).toEqual({ player: "White", pieceType: "King" });
    expect(getPiece(after.board, [0, 0])).toEqual({ player: "Black", type: "King" });
    // Continue: place White King on the right half; placement advances.
    s().activateSquare([0, 11]);
    expect(s().placementCursor).toBe(2);
    expect(getPiece(s().board, [0, 11])).toEqual({ player: "White", type: "King" });
  });

  it("restores after the first action and allows the second action", () => {
    const first = findFirstLegalMove();
    s().activateSquare(first.start);
    s().activateSquare(first.end);
    expect(s().movesThisTurn).toBe(1);
    const player = s().currentPlayer;

    expect(exportDisturbImport()).toBe(true);
    expect(s().movesThisTurn).toBe(1);
    expect(s().currentPlayer).toBe(player);
    // Second action still available and does not duplicate the first.
    const second = findFirstLegalMove();
    s().activateSquare(second.start);
    s().activateSquare(second.end);
    expect(s().movesThisTurn === 0 || s().currentPlayer !== player).toBe(true);
  });

  it("restores a pending Defended-King decision and resolves it deterministically", () => {
    setScenario(defendedKingScenario());
    s().activateSquare([5, 1]);
    s().activateSquare([5, 3]);
    s().activateSquare([5, 3]);
    expect(s().phase.phase).toBe("defenderSelection");

    expect(exportDisturbImport()).toBe(true);
    expect(s().phase.phase).toBe("defenderSelection");
    expect(s().pendingDefendedKing?.owner).toBe("White");
    expect(s().pendingDefendedKing?.defenders).toEqual([[4, 3]]);

    s().chooseDefender([4, 3]);
    const resolved = s();
    expect(resolved.phase.phase).toBe("playing");
    expect(resolved.currentPlayer).toBe("White");
    expect(getPiece(resolved.board, [4, 3])).toBeNull();
    expect(resolved.board.capturedPieces.White.DefensePawn).toBe(1);
  });

  it("restores a pending Transform decision and applies the chosen piece without rerolling", () => {
    setScenario(transformScenario());
    s().activateSquare([5, 5]);
    s().activateSquare([5, 6]);
    expect(s().phase.phase).toBe("transformSelection");

    expect(exportDisturbImport()).toBe(true);
    expect(s().phase.phase).toBe("transformSelection");
    expect(s().pendingTransform).toMatchObject({ owner: "Black", pieceType: "AttackPawn" });

    s().chooseTransform("ConquestPawn");
    const after = s();
    expect(getPiece(after.board, [5, 6])).toEqual({ player: "Black", type: "ConquestPawn" });
    expect(after.phase.phase).toBe("playing");
    expect(after.currentPlayer).toBe("White");
  });

  it("derives later-turn Transform eligibility after save and load", () => {
    setScenario(transformScenario(), { movesThisTurn: 1 });
    s().activateSquare([5, 5]);
    s().activateSquare([5, 6]);
    expect(s().currentPlayer).toBe("White");
    expect(s().pendingTransform).toBeNull();
    expect(s().board.transformSquares).toEqual([[5, 6]]);
    s().passTurn();
    expect(s().currentPlayer).toBe("Black");

    expect(exportDisturbImport()).toBe(true);
    expect(s().pendingTransform).toBeNull();
    s().activateSquare([5, 6]);
    s().activateSquare([5, 6]);
    expect(s().phase.phase).toBe("transformSelection");
    s().chooseTransform("DefensePawn");
    expect(getPiece(s().board, [5, 6])?.type).toBe("DefensePawn");
    expect(s().movesThisTurn).toBe(1);
    expect(s().currentPlayer).toBe("Black");
  });

  it("restores an active territory claim and matures it to victory", () => {
    setScenario(territoryScenario());
    s().passTurn();
    expect(s().board.territoryClaim).toEqual({ claimant: "Black", createdTurn: 1, matureTurn: 3 });

    expect(exportDisturbImport()).toBe(true);
    expect(s().board.territoryClaim).toEqual({ claimant: "Black", createdTurn: 1, matureTurn: 3 });
    // Advance through the opponent response window to victory.
    s().passTurn();
    expect(s().phase.phase).toBe("playing");
    s().passTurn();
    expect(s().phase.phase).toBe("gameOver");
    expect(s().message).toContain("territory");
  });

  it("restores a timed match preserving remaining time without deducting unloaded wall time", () => {
    startPlayingMatch({ timerSeconds: 300, setupSeed: 5 });
    s().startClock(1000);
    s().tickClock(6000); // 5s elapsed
    expect(s().timeLeft.Black).toBe(295);

    // Keep the save-time clock in the same synthetic timeline as startClock/tickClock.
    // Otherwise a long-running coverage process can make performance.now() exceed
    // 6000 and turn this characterization test into an uptime-dependent flake.
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(6000);
    try {
      expect(exportDisturbImport()).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
    // Remaining time preserved; clock is not running after load (no elapsed deduction).
    expect(s().timeLeft.Black).toBe(295);
    expect(s().timeLeft.White).toBe(300);
    expect(s().clockRunningFor).toBeNull();
  });

  it("restores a completed (timeout) match and accepts no further gameplay action", () => {
    startPlayingMatch({ timerSeconds: 300, setupSeed: 8 });
    s().startClock(1000);
    s().tickClock(302000); // Black flag falls
    expect(s().phase.phase).toBe("gameOver");
    const boardBefore = JSON.stringify(s().board.grid);

    expect(exportDisturbImport()).toBe(true);
    expect(s().phase.phase).toBe("gameOver");
    expect(s().message).toContain("timeout");
    // A gameplay action does not mutate a terminal match.
    s().passTurn();
    s().activateSquare([0, 0]);
    expect(s().phase.phase).toBe("gameOver");
    expect(JSON.stringify(s().board.grid)).toBe(boardBefore);
  });
});

// --- Phase 5: undo hardening ------------------------------------------------

describe("undo restores full authoritative state", () => {
  it("undoes a placement", () => {
    s().startManualPlacement({ seed: 77 });
    s().activateSquare([0, 0]);
    expect(s().placementCursor).toBe(1);
    s().undo();
    expect(s().placementCursor).toBe(0);
    expect(getPiece(s().board, [0, 0])).toBeNull();
    expect(s().currentPlacement).toEqual({ player: "Black", pieceType: "King" });
  });

  it("undoes a move restoring player, action points and board", () => {
    const move = findFirstLegalMove();
    const player = s().currentPlayer;
    s().activateSquare(move.start);
    s().activateSquare(move.end);
    s().undo();
    expect(s().currentPlayer).toBe(player);
    expect(s().movesThisTurn).toBe(0);
    expect(getPiece(s().board, move.end)).toBeNull();
  });

  it("undoes a resolved Defended-King back before the attack", () => {
    setScenario(defendedKingScenario());
    s().activateSquare([5, 1]);
    s().activateSquare([5, 3]);
    s().chooseDefender([4, 3]);
    expect(s().phase.phase).toBe("playing");
    s().undo();
    // Back to the pending decision with the defender restored.
    expect(getPiece(s().board, [4, 3])).toEqual({ player: "White", type: "DefensePawn" });
    expect(s().board.capturedPieces.White.DefensePawn).toBe(0);
  });

  it("preserves undo history across export/import", () => {
    const move = findFirstLegalMove();
    s().activateSquare(move.start);
    s().activateSquare(move.end);
    expect(s().history.length).toBe(1);
    expect(exportDisturbImport()).toBe(true);
    expect(s().history.length).toBe(1);
    s().undo();
    expect(getPiece(s().board, move.end)).toBeNull();
  });
});

// --- Phase 6: timer lifecycle ----------------------------------------------

describe("timer lifecycle is deterministic", () => {
  it("saving syncs elapsed time into the persisted state", () => {
    const store = installLocalStorage();
    startPlayingMatch({ timerSeconds: 300, setupSeed: 5 });
    s().startClock(0);
    // saveGame calls syncClock(monotonicNow()); we assert timeLeft is persisted (>=0, valid).
    s().saveGame();
    const saved = JSON.parse(store.get("assalto-reale-save") ?? "{}");
    expect(saved.timeLeft.Black).toBeLessThanOrEqual(300);
    expect(saved.timeLeft.Black).toBeGreaterThanOrEqual(0);
  });

  it("untimed matches never produce a timeout after round-trip", () => {
    startPlayingMatch({ timerSeconds: 0, setupSeed: 9 });
    expect(exportDisturbImport()).toBe(true);
    s().startClock(0);
    s().tickClock(10_000_000);
    expect(s().phase.phase).not.toBe("gameOver");
    expect(s().timeLeft.Black).toBe(0); // untimed represents time as 0 and never flags
  });
});

// --- Phase 7: validation & migration ---------------------------------------

describe("save validation rejects malformed data atomically", () => {
  function validExport(): Record<string, unknown> {
    const move = findFirstLegalMove();
    s().activateSquare(move.start);
    s().activateSquare(move.end);
    return JSON.parse(s().exportSaveJson() ?? "{}");
  }

  const mutations: Array<[string, (v: Record<string, unknown>) => void]> = [
    ["missing schema", (v) => delete v.schema],
    ["future schema", (v) => (v.schema = 4)],
    ["invalid phase name", (v) => (v.phase = { phase: "wormhole" })],
    ["unknown piece type", (v) => ((v.board as { grid: unknown[][] }).grid[0][0] = { player: "Black", type: "Dragon" })],
    ["invalid player colour", (v) => (v.currentPlayer = "Green")],
    ["negative action points", (v) => (v.movesThisTurn = -1)],
    ["too many action points", (v) => (v.movesThisTurn = 3)],
    ["negative turn counter", (v) => (v.turnCounter = -5)],
    ["negative clock", (v) => (v.timeLeft = { Black: -1, White: 10 })],
    ["placement cursor out of range", (v) => (v.placementCursor = 999)],
    ["malformed pending decision owner", (v) => (v.pendingDefendedKing = { owner: "Nobody" })],
    ["out-of-bounds special square", (v) => ((v.board as { special_squares: unknown[] }).special_squares = [[99, 99]])],
  ];

  for (const [name, mutate] of mutations) {
    it(`rejects: ${name} (active match preserved)`, () => {
      const good = validExport();
      const bad = structuredClone(good);
      mutate(bad);
      // Fresh active match to protect.
      startPlayingMatch({ setupSeed: 3 });
      expect(s().importSaveJson(JSON.stringify(bad))).toBe(false);
      expect(s().phase.phase).toBe("playing");
      expect(s().hasActiveMatch).toBe(true);
    });
  }

  it("rejects non-JSON without touching the active match", () => {
    startPlayingMatch({ setupSeed: 4 });
    expect(s().importSaveJson("{not json")).toBe(false);
    expect(s().phase.phase).toBe("playing");
  });

  it("accepts a legacy schema-1 save and restores it with pending/history cleared", () => {
    const good = JSON.parse(s().exportSaveJson() ?? "{}");
    const legacy = { ...good, schema: 1, pendingTransform: undefined, pendingDefendedKing: undefined, history: undefined };
    startPlayingMatch({ setupSeed: 6 });
    expect(s().importSaveJson(JSON.stringify(legacy))).toBe(true);
    expect(s().pendingTransform).toBeNull();
    expect(s().pendingDefendedKing).toBeNull();
    expect(s().history).toEqual([]);
    expect(s().hasActiveMatch).toBe(true);
  });
});

describe("completed local lifecycle", () => {
  it("normalizes an older completed save with a stale active flag", () => {
    startPlayingMatch({ setupSeed: 60 });
    const saved = JSON.parse(s().exportSaveJson() ?? "{}") as Record<string, unknown>;
    saved.phase = { phase: "gameOver" };
    saved.hasActiveMatch = true;

    expect(s().importSaveJson(JSON.stringify(saved))).toBe(true);
    expect(s().phase.phase).toBe("gameOver");
    expect(s().hasActiveMatch).toBe(false);
  });

  it("clears only the active pointer when returning Home", () => {
    startPlayingMatch({ setupSeed: 61 });
    const boardBefore = JSON.stringify(s().board);
    const historyBefore = JSON.stringify(s().history);
    useGameStore.setState({
      phase: { phase: "gameOver" },
      hasActiveMatch: true,
      message: "Black wins by resignation.",
    });

    s().returnHome();

    expect(s().hasActiveMatch).toBe(false);
    expect(s().phase.phase).toBe("gameOver");
    expect(JSON.stringify(s().board)).toBe(boardBefore);
    expect(JSON.stringify(s().history)).toBe(historyBefore);
  });
});

// --- Phase 8: storage-failure handling -------------------------------------

describe("storage failures fail safe", () => {
  it("reports and does not corrupt the match when localStorage is unavailable", () => {
    removeLocalStorage();
    const phaseBefore = s().phase.phase;
    s().saveGame();
    expect(s().message).toBe("Save is not available in this environment.");
    s().loadGame();
    expect(s().message).toBe("Load is not available in this environment.");
    expect(s().phase.phase).toBe(phaseBefore);
  });

  it("reports and preserves the in-memory match when a storage write throws (quota)", () => {
    installThrowingLocalStorage();
    const gridBefore = JSON.stringify(s().board.grid);
    s().saveGame();
    expect(s().message).toContain("Could not save");
    // In-memory game is untouched.
    expect(JSON.stringify(s().board.grid)).toBe(gridBefore);
    expect(s().phase.phase).toBe("playing");
  });

  it("returns null message safely when no save is present", () => {
    installLocalStorage();
    s().loadGame();
    expect(s().message).toBe("No valid local save found.");
  });
});

// --- Phase 9: AI restoration -----------------------------------------------

describe("AI restoration does not double-act or stall", () => {
  it("restores an AI-owned Defended-King decision and resolves it once", () => {
    setScenario(defendedKingScenario(), { aiEnabled: true, aiPlayer: "White" });
    s().activateSquare([5, 1]);
    s().activateSquare([5, 3]);
    s().activateSquare([5, 3]);
    expect(s().pendingDefendedKing?.owner).toBe("White");

    expect(exportDisturbImport()).toBe(true);
    expect(s().pendingDefendedKing?.owner).toBe("White");
    s().runAiTurn();
    expect(s().pendingDefendedKing).toBeNull();
    expect(s().board.capturedPieces.White.DefensePawn).toBe(1);
  });

  it("restores an AI turn and produces exactly one action per runAiTurn", () => {
    startPlayingMatch({ opponent: "Computer" });
    useGameStore.setState({ currentPlayer: "White" });
    expect(exportDisturbImport()).toBe(true);
    // Imported save keeps AI ownership; a single runAiTurn advances history by one.
    const before = s().history.length;
    if (s().aiEnabled) {
      useGameStore.setState({ currentPlayer: s().aiPlayer });
      s().runAiTurn();
      expect(s().history.length).toBe(before + 1);
    }
  });

  it("loading a different save replaces the previous match state entirely", () => {
    // Save A: placement.
    s().startManualPlacement({ seed: 77 });
    s().activateSquare([0, 0]);
    const saveA = s().exportSaveJson() ?? "";
    // Save B: a fresh quick playing match, persisted.
    startPlayingMatch({ setupSeed: 21 });
    s().saveGame();
    // Import A over B.
    expect(s().importSaveJson(saveA)).toBe(true);
    expect(s().phase.phase).toBe("placement");
    expect(s().placementCursor).toBe(1);
  });
});
