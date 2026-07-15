import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BoardState } from "../game/engine";
import { GameBoard } from "../board/GameBoard";
import { CapturedPieces, GameStatus, MatchPanel, VictoryPanel } from "./GamePage";

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
  controlledSquares: {
    Black: [
      [0, 0],
      [0, 1],
      [0, 2],
    ],
    White: [],
  },
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
  it("offers transform and ignore choices directly on the board", () => {
    const pendingTransform = {
      owner: "Black",
      player: "Black",
      pieceType: "AttackPawn",
      pos: [0, 0],
      forceTurnSwitch: false,
    } as const;

    const html = renderToStaticMarkup(
      <GameBoard
        board={{ ...board, transformSquares: [[0, 0]] }}
        transformDecision={pendingTransform}
        onChooseTransform={noop}
        onDeclineTransform={noop}
      />,
    );

    expect(html).toContain("Defense Pawn");
    expect(html).toContain("Conquest Pawn");
    expect(html).toContain("Ignore Transform Square");
    expect(html).toContain("transformDecisionAnchor");
    expect(html).not.toContain("matchPanel");
  });

  it("shows compact active-play controls and captured pieces", () => {
    const html = renderToStaticMarkup(
      <MatchPanel
        board={board}
        lastAction="Black moved a pawn."
        passTurn={noop}
        undo={noop}
        saveGame={noop}
        loadGame={noop}
        disabled={false}
      />,
    );

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
    const defendedBoard = {
      ...board,
      grid: board.grid.map((row) => row.map((piece) => (piece ? { ...piece } : null))),
    } as BoardState;
    defendedBoard.grid[5][5] = { player: "White", type: "King" };
    defendedBoard.grid[5][4] = { player: "White", type: "DefensePawn" };

    const html = renderToStaticMarkup(<GameBoard board={defendedBoard} />);

    expect(html).toContain("defended King");
    expect(html).not.toContain("defendedKingMark");
  });

  it("uses restrained border treatments for Special and Transform Squares", () => {
    const decoratedBoard = {
      ...board,
      transformSquares: [[1, 1]],
    } as unknown as BoardState;

    const html = renderToStaticMarkup(<GameBoard board={decoratedBoard} />);

    expect(html).toContain("specialSquareInset");
    expect(html).toContain("specialCornerMarks");
    expect(html).toContain("transformSquareOuter");
    expect(html).toContain("transformSquareInner");
    expect(html).not.toContain("specialGlow");
  });

  it("renders only the defended King, sacrificed defender fade, and final landing preview", () => {
    const html = renderToStaticMarkup(
      <GameBoard
        board={board}
        defendedKingPreview={{
          attackerOrigin: [5, 3],
          kingPosition: [4, 3],
          defenders: [
            [4, 2],
            [4, 4],
          ],
          attackPath: [
            [5, 3],
            [4, 3],
          ],
          bouncePath: [
            [5, 3],
            [6, 3],
            [7, 3],
          ],
          landingPosition: [7, 3],
          triggersTransform: true,
        }}
      />,
    );

    expect(html).toContain("defendedKingPreview");
    expect(html).toContain("previewKing");
    expect(html).toContain("previewLandingTarget selected triggersTransform");
    expect(html).not.toContain("previewAttackPath");
    expect(html).not.toContain("previewBouncePath");
    expect(html).not.toContain("previewRouteStep");
    expect(html).not.toContain("previewJumpArc");
    expect(html).not.toContain("previewTurn");
    expect(html).not.toContain("previewGhostAttacker");
    expect(html).not.toContain("dialog");
    expect(html).not.toContain("Cancel Attack");
    expect(html).not.toContain("matchPanel");
  });

  it("shows victory winner and controls", () => {
    const html = renderToStaticMarkup(
      <VictoryPanel message="Black wins by king capture." saveGame={noop} rematch={noop} newMatch={noop} home={noop} />,
    );

    expect(html).toContain("Black wins by king capture.");
    expect(html).toContain("Rematch");
    expect(html).toContain("New Match");
    expect(html).toContain("Match complete");
  });
});
