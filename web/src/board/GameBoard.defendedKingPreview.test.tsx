// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoard, setPiece, type DeflectionRoute } from "../game/engine";
import { GameBoard, type DefendedKingBoardPreview } from "./GameBoard";

afterEach(() => {
  cleanup();
});

function preview(routes?: DeflectionRoute[], selectedRouteId: DefendedKingBoardPreview["selectedRouteId"] = "primary") {
  return {
    attackerOrigin: [5, 2],
    kingPosition: [5, 4],
    defenders: [[5, 3]],
    attackPath: [
      [5, 2],
      [5, 3],
      [5, 4],
    ],
    bouncePath: routes?.find((route) => route.id === selectedRouteId)?.path ?? [
      [5, 1],
      [5, 0],
    ],
    landingPosition: routes?.find((route) => route.id === selectedRouteId)?.landingPosition ?? [5, 0],
    triggersTransform: false,
    routes,
    selectedRouteId,
  } satisfies DefendedKingBoardPreview;
}

function boardWithDefendedKing() {
  const board = createBoard();
  setPiece(board, [5, 2], { player: "Black", type: "AttackPawn" });
  setPiece(board, [5, 3], { player: "White", type: "DefensePawn" });
  setPiece(board, [5, 4], { player: "White", type: "King" });
  return board;
}

const primary: DeflectionRoute = {
  id: "primary",
  path: [
    [5, 1],
    [5, 0],
  ],
  jumpedSquares: [[5, 1]],
  turnSquares: [],
  landingPosition: [5, 0],
};

const clockwise: DeflectionRoute = {
  id: "clockwise",
  path: [
    [4, 2],
    [4, 1],
    [4, 0],
  ],
  jumpedSquares: [],
  turnSquares: [[4, 2]],
  landingPosition: [4, 0],
};

describe("simplified Defended King board preview", () => {
  it("shows only the King, faded pieces, and selected final landing", () => {
    const view = render(
      <GameBoard board={boardWithDefendedKing()} defendedKingPreview={preview([primary])} onDefendedKingRouteSelect={vi.fn()} />,
    );

    expect(view.container.querySelector(".previewKing")).not.toBeNull();
    expect(view.container.querySelector(".previewSacrificePiece")).not.toBeNull();
    expect(view.container.querySelector(".previewOriginPiece")).not.toBeNull();
    expect(view.container.querySelector(".previewLandingTarget.selected")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Selected primary final landing A7" })).toBeTruthy();

    expect(view.container.querySelector(".previewPath")).toBeNull();
    expect(view.container.querySelector(".previewRouteStep")).toBeNull();
    expect(view.container.querySelector(".previewJumpArc")).toBeNull();
    expect(view.container.querySelector(".previewTurn")).toBeNull();
    expect(view.container.querySelector(".previewGhostAttacker")).toBeNull();
    expect(view.container.querySelector("polyline")).toBeNull();
    expect(view.container.querySelector("marker")).toBeNull();
  });

  it("keeps different final landing squares selectable by pointer and keyboard", () => {
    const selectRoute = vi.fn();
    render(
      <GameBoard
        board={boardWithDefendedKing()}
        defendedKingPreview={preview([primary, clockwise])}
        onDefendedKingRouteSelect={selectRoute}
      />,
    );

    const primaryLanding = screen.getByRole("button", { name: "Selected primary final landing A7" });
    const clockwiseLanding = screen.getByRole("button", { name: "Select clockwise final landing A8" });
    expect(primaryLanding.getAttribute("data-selected")).toBe("true");
    expect(clockwiseLanding.getAttribute("data-selected")).toBe("false");

    fireEvent.click(clockwiseLanding);
    expect(selectRoute).toHaveBeenLastCalledWith("clockwise");
    fireEvent.keyDown(primaryLanding, { key: "Enter" });
    expect(selectRoute).toHaveBeenLastCalledWith("primary");
  });

  it("offers minimal clockwise and counter-clockwise controls for a shared landing", () => {
    const sharedClockwise: DeflectionRoute = { ...clockwise, landingPosition: [5, 0] };
    const counterClockwise: DeflectionRoute = {
      ...clockwise,
      id: "counterClockwise",
      path: [
        [6, 2],
        [6, 1],
        [5, 0],
      ],
      turnSquares: [[6, 2]],
      landingPosition: [5, 0],
    };
    const selectRoute = vi.fn();
    const view = render(
      <GameBoard
        board={boardWithDefendedKing()}
        defendedKingPreview={preview([sharedClockwise, counterClockwise], "clockwise")}
        onDefendedKingRouteSelect={selectRoute}
      />,
    );

    const clockwiseChoice = screen.getByRole("button", { name: "Selected clockwise route to final landing A7" });
    const counterClockwiseChoice = screen.getByRole("button", {
      name: "Select counter-clockwise route to final landing A7",
    });
    expect(view.container.querySelectorAll(".previewLandingTarget")).toHaveLength(1);
    expect(view.container.querySelectorAll(".previewRouteChoice")).toHaveLength(2);
    expect(view.container.textContent).toContain("↻");
    expect(view.container.textContent).toContain("↺");

    fireEvent.click(counterClockwiseChoice);
    expect(selectRoute).toHaveBeenLastCalledWith("counterClockwise");
    fireEvent.keyDown(clockwiseChoice, { key: " " });
    expect(selectRoute).toHaveBeenLastCalledWith("clockwise");
  });

  it("allows the second King click to pass through as the commit action", () => {
    const activate = vi.fn();
    render(
      <GameBoard
        board={boardWithDefendedKing()}
        defendedKingPreview={preview([primary])}
        onSquareActivate={activate}
        onDefendedKingRouteSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("gridcell", { name: /E7, White King, defended King/ }));
    expect(activate).toHaveBeenCalledWith([5, 4]);
  });
});
