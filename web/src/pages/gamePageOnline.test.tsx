import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createBoard, createEmptyPiecesLeft, type BoardState, type Player } from "../game/engine";
import { GameStatus, MatchPanel, PlacementPanel, VictoryPanel } from "./GamePage";

const board: BoardState = createBoard({ transformEnabled: false });
const timeLeft: Record<Player, number> = { Black: 0, White: 0 };
const noop = () => {};

function status(overrides: Partial<Parameters<typeof GameStatus>[0]> = {}) {
  return renderToStaticMarkup(
    <GameStatus
      phase="playing"
      currentPlayer="Black"
      currentPlacement={null}
      movesThisTurn={0}
      aiControlsTurn={false}
      board={board}
      timerSeconds={0}
      timeLeft={timeLeft}
      timerLabel="Untimed"
      selectedWithoutTargets={false}
      {...overrides}
    />,
  );
}

describe("online turn labelling", () => {
  it("frames the turn around the viewer online (Your turn / Opponent's turn)", () => {
    expect(status({ currentPlayer: "Black", viewerSide: "Black" })).toContain("Your turn");
    expect(status({ currentPlayer: "Black", viewerSide: "White" })).toContain("Opponent&#x27;s turn");
  });

  it("keeps a neutral colour label offline (no viewer side)", () => {
    const html = status({ currentPlayer: "White", viewerSide: null });
    expect(html).toContain("White to move");
    expect(html).not.toContain("Your turn");
  });

  it("frames placement around the viewer online", () => {
    const placing = { player: "Black" as Player, pieceType: "King" };
    expect(status({ phase: "placement", currentPlacement: placing, viewerSide: "Black" })).toContain("Place a King");
    expect(status({ phase: "placement", currentPlacement: placing, viewerSide: "White" })).toContain("Opponent is placing");
  });
});

describe("online-only control visibility", () => {
  const piecesLeft = createEmptyPiecesLeft();

  it("hides local Undo/Save/Load in the online match panel but keeps Pass", () => {
    const online = renderToStaticMarkup(
      <MatchPanel board={board} lastAction="—" passTurn={noop} undo={noop} saveGame={noop} loadGame={noop} disabled={false} online />,
    );
    expect(online).toContain("Pass");
    expect(online).not.toContain("Undo");
    expect(online).not.toContain("Save");
    expect(online).not.toContain("Load");
  });

  it("shows the full local controls offline", () => {
    const offline = renderToStaticMarkup(
      <MatchPanel board={board} lastAction="—" passTurn={noop} undo={noop} saveGame={noop} loadGame={noop} disabled={false} />,
    );
    expect(offline).toContain("Undo");
    expect(offline).toContain("Save");
    expect(offline).toContain("Load");
  });

  it("hides local Undo/Save during online placement", () => {
    const online = renderToStaticMarkup(
      <PlacementPanel
        currentPlacement={{ player: "Black", pieceType: "King" }}
        piecesLeft={piecesLeft}
        placementCursor={0}
        placementValidCount={5}
        message="Place your King"
        undo={noop}
        saveGame={noop}
        disabled={false}
        online
      />,
    );
    expect(online).not.toContain("Undo");
    expect(online).not.toContain("Save");
  });

  it("offers only rematch and return-home in the online victory panel", () => {
    const online = renderToStaticMarkup(
      <VictoryPanel message="Black wins" saveGame={noop} rematch={noop} newMatch={noop} home={noop} online />,
    );
    expect(online).toContain("Rematch");
    expect(online).toContain("Return home");
    expect(online).not.toContain("New Match");
    expect(online).not.toContain(">Save<");
  });

  it("disables the board-level rematch action when the opponent left", () => {
    const online = renderToStaticMarkup(
      <VictoryPanel message="Black wins" saveGame={noop} rematch={noop} newMatch={noop} home={noop} online rematchUnavailable />,
    );
    expect(online).toContain("Opponent left the post-game room.");
    expect(online).toContain("disabled");
  });
});
