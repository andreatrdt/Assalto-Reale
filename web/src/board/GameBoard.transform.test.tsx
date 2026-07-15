// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoard, setPiece, type PawnType, type PendingTransform } from "../game/engine";
import { GameBoard } from "./GameBoard";
import boardStyles from "./GameBoard.css?raw";

afterEach(() => {
  cleanup();
});

function decision(pieceType: PawnType = "AttackPawn"): PendingTransform {
  return {
    owner: "Black",
    player: "Black",
    pos: [5, 6],
    pieceType,
    forceTurnSwitch: false,
  };
}

describe("board-native Transform decision", () => {
  it("uses compact pawn-icon tiles and a neutral Ignore control", () => {
    const board = createBoard({ transformEnabled: true });
    board.transformSquares = [[5, 6]];
    setPiece(board, [5, 6], { player: "Black", type: "AttackPawn" });
    const choose = vi.fn();
    const decline = vi.fn();

    const view = render(<GameBoard board={board} transformDecision={decision()} onChooseTransform={choose} onDeclineTransform={decline} />);

    const picker = view.container.querySelector(".transformDecision");
    expect(picker?.querySelectorAll(".transformDecisionPiece .piece")).toHaveLength(1);
    expect(picker?.querySelectorAll("circle")).toHaveLength(0);
    expect(picker?.textContent).toBe("×");
    expect(view.container.querySelector(".transformDecisionAnchor")).toBeNull();
    expect(view.container.querySelector("[role='dialog']")).toBeNull();
    expect(view.container.querySelector(".matchPanel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Transform into Defense Pawn" }));
    expect(choose).toHaveBeenCalledWith("DefensePawn");
    fireEvent.click(screen.getByRole("button", { name: "Ignore transformation" }));
    expect(decline).toHaveBeenCalledOnce();

    expect(boardStyles).not.toContain(".transformDecisionAnchor");
    expect(boardStyles).not.toContain(".transformDecisionChoice circle");
    expect(boardStyles).not.toContain("#f2c76e");
  });

  it("supports keyboard activation and omits the current pawn type", () => {
    const board = createBoard({ transformEnabled: true });
    board.transformSquares = [[5, 6]];
    setPiece(board, [5, 6], { player: "Black", type: "ConquestPawn" });
    const choose = vi.fn();
    const decline = vi.fn();

    const view = render(
      <GameBoard board={board} transformDecision={decision("ConquestPawn")} onChooseTransform={choose} onDeclineTransform={decline} />,
    );

    expect(view.container.querySelectorAll(".transformDecisionPiece .piece")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Transform into Conquest Pawn" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Transform into Attack Pawn" }), { key: "Enter" });
    expect(choose).toHaveBeenCalledWith("AttackPawn");
    fireEvent.keyDown(screen.getByRole("button", { name: "Ignore transformation" }), { key: " " });
    expect(decline).toHaveBeenCalledOnce();
  });
});
