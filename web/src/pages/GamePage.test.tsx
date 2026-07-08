import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BoardState } from "../game/engine";
import { GameBoard } from "../board/GameBoard";
import { CapturedPieces, DefendedKingPanel, GameStatus, MatchPanel, TransformPanel, VictoryPanel } from "./GamePage";

const noop = () => undefined;

const board = {
  config: { rows: 12, cols: 12, specialCount: 5, transformEnabled: true, transformRound: 5 },
  grid: Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => null)),
  specialSquares: [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
  ],
  transformSquares: [],
  controlledSquares: { Black: [[0, 0], [0, 1], [0, 2]], White: [] },
  territoryClaim: null,
  capturedPieces: {
    Black: { AttackPawn: 2, DefensePawn: 1, ConquestPawn: 0, King: 0 },
    White: { AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0, King: 0 },
  },
} as unknown as BoardState;

describe("GameStatus", () => {
  it("shows a plain active-turn status with action points and timer", () => {
    const html = renderToStaticMarkup(
      <GameStatus
        phase="playing"
        currentPlayer="Black"
        currentPlacement={null}
        movesThisTurn={0}
        aiControlsTurn={false}
        board={board}
        timerSeconds={300}
        timeLeft={{ Black: 298, White: 300 }}
        timerLabel="5 minutes"
        selectedWithoutTargets={false}
      />,
    );

    expect(html).toContain("Black to move");
    expect(html).toContain("2 actions remaining");
    expect(html).toContain("4:58");
    expect(html).toContain("Black controls 3 of 5 Special Squares");
  });

  it("describes manual placement in plain language", () => {
    const html = renderToStaticMarkup(
      <GameStatus
        phase="placement"
        currentPlayer="White"
        currentPlacement={{ player: "White", pieceType: "AttackPawn" }}
        movesThisTurn={0}
        aiControlsTurn={false}
        board={board}
        timerSeconds={0}
        timeLeft={{ Black: 0, White: 0 }}
        timerLabel="Untimed"
        selectedWithoutTargets={false}
      />,
    );

    expect(html).toContain("White is placing an Attack Pawn");
    expect(html).not.toContain("actions remaining");
  });

  it("shows a quiet Computer is thinking state", () => {
    const html = renderToStaticMarkup(
      <GameStatus
        phase="playing"
        currentPlayer="White"
        currentPlacement={null}
        movesThisTurn={0}
        aiControlsTurn
        board={board}
        timerSeconds={0}
        timeLeft={{ Black: 0, White: 0 }}
        timerLabel="Untimed"
        selectedWithoutTargets={false}
      />,
    );

    expect(html).toContain("Computer is thinking");
    expect(html).not.toContain("%");
  });
});

describe("Game decision and control panels", () => {
  it("preserves the full defended-King preview and cancel control", () => {
    const pendingDefendedKing = {
      owner: "White",
      action: { player: "Black" },
      defenders: [[3, 3]],
      preview: {
        attackerOrigin: [5, 3],
        kingPosition: [4, 3],
        attackPath: [
          [5, 3],
          [4, 3],
        ],
        bouncePath: [
          [6, 3],
          [7, 3],
        ],
        landingPosition: [7, 3],
        actionCost: 2,
        triggersTransform: false,
        endsTurn: true,
        eligibleDefenderIds: [],
      },
    } as unknown as Parameters<typeof DefendedKingPanel>[0]["pendingDefendedKing"];

    const html = renderToStaticMarkup(<DefendedKingPanel pendingDefendedKing={pendingDefendedKing} message="White: choose a defender." cancel={noop} />);

    expect(html).toContain("Attacking pawn");
    expect(html).toContain("Attacked King");
    expect(html).toContain("Attack path");
    expect(html).toContain("Bounce path");
    expect(html).toContain("Landing");
    expect(html).toContain("Defenders");
    expect(html).toContain("2 AP");
    expect(html).toContain("Ends turn");
    expect(html).toContain("Cancel Attack");
  });

  it("offers the transform replacement choices for the current pawn", () => {
    const pendingTransform = {
      player: "Black",
      pieceType: "AttackPawn",
      pos: [0, 0],
    } as unknown as Parameters<typeof TransformPanel>[0]["pendingTransform"];

    const html = renderToStaticMarkup(<TransformPanel pendingTransform={pendingTransform} message="Choose a transform." chooseTransform={noop} />);

    expect(html).toContain("Defense Pawn");
    expect(html).toContain("Conquest Pawn");
    expect(html).not.toContain("Attack Pawn");
  });

  it("shows compact active-play controls and captured pieces", () => {
    const html = renderToStaticMarkup(<MatchPanel board={board} lastAction="Black moved a pawn." passTurn={noop} undo={noop} saveGame={noop} loadGame={noop} disabled={false} />);

    expect(html).toContain("Pass");
    expect(html).toContain("Undo");
    expect(html).toContain("Save");
    expect(html).toContain("Load");
    expect(html).toContain("Captured");
    expect(html).toContain("Last move");
  });

  it("renders captured material as repeated piece glyphs instead of inventory text", () => {
    const html = renderToStaticMarkup(<CapturedPieces board={board} />);

    expect(html.match(/Black Attack Pawn captured/g)).toHaveLength(2);
    expect(html).toContain("Black Defense Pawn captured");
    expect(html).toContain("No White pieces captured");
    expect(html).toContain("capturedPieceIcon");
    expect(html).not.toContain("Attack 2 /");
  });

  it("does not render a defended-King shield on the board", () => {
    const defendedBoard = structuredClone(board);
    defendedBoard.grid[5][5] = { player: "White", type: "King" };
    defendedBoard.grid[5][4] = { player: "White", type: "DefensePawn" };

    const html = renderToStaticMarkup(<GameBoard board={defendedBoard} />);

    expect(html).toContain("defended King");
    expect(html).not.toContain("defendedKingMark");
  });

  it("shows victory winner and controls", () => {
    const html = renderToStaticMarkup(<VictoryPanel message="Black wins by king capture." saveGame={noop} rematch={noop} newMatch={noop} home={noop} />);

    expect(html).toContain("Black wins by king capture.");
    expect(html).toContain("Rematch");
    expect(html).toContain("New Match");
    expect(html).toContain("Match complete");
  });
});
