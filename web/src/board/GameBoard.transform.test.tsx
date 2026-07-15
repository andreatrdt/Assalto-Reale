// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoard, setPiece, type PendingTransform } from "../game/engine";
import { GameBoard } from "./GameBoard";

afterEach(() => {
  cleanup();
});

function decision(): PendingTransform {
  return {
    owner: "Black",
    player: "Black",
    pos: [5, 6],
    pieceType: "AttackPawn",
    forceTurnSwitch: false,
  };
}

describe("board-native Transform decision", () => {
  it("offers replacement types and Ignore on the occupied board square", () => {
    const board = createBoard({ transformEnabled: true });
    board.transformSquares = [[5, 6]];
    setPiece(board, [5, 6], { player: "Black", type: "AttackPawn" });
    const choose = vi.fn();
    const decline = vi.fn();

    const view = render(<GameBoard board={board} transformDecision={decision()} onChooseTransform={choose} onDeclineTransform={decline} />);

    expect(view.container.querySelector(".transformDecisionAnchor")).not.toBeNull();
    expect(view.container.querySelector("[role='dialog']")).toBeNull();
    expect(view.container.querySelector(".matchPanel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Transform into Defense Pawn" }));
    expect(choose).toHaveBeenCalledWith("DefensePawn");
    fireEvent.click(screen.getByRole("button", { name: "Ignore Transform Square" }));
    expect(decline).toHaveBeenCalledOnce();
  });

  it("supports keyboard activation without presenting the current pawn type", () => {
    const board = createBoard({ transformEnabled: true });
    board.transformSquares = [[5, 6]];
    setPiece(board, [5, 6], { player: "Black", type: "AttackPawn" });
    const choose = vi.fn();

    render(<GameBoard board={board} transformDecision={decision()} onChooseTransform={choose} />);

    expect(screen.queryByRole("button", { name: "Transform into Attack Pawn" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Transform into Conquest Pawn" }), { key: "Enter" });
    expect(choose).toHaveBeenCalledWith("ConquestPawn");
  });
});
