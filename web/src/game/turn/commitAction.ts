// Turn-resolution orchestration extracted from the store. `resolveCommit` is a
// pure function: given the current state and a validated action, it applies the
// action through the engine and returns the state patch (including the
// error-only patch). It does not duplicate movement/capture rules — those stay
// in the engine; it coordinates half-turn advance, transform prompts, history
// push and phase transitions.
import { applyAction, type Action } from "../engine";
import type { PhaseState } from "../../app/phases";
import { createHistoryEntry } from "../history/historyController";
import type { GameState, StatePatch } from "../state/storeTypes";
import { advanceHalfTurn, describeAction, describePiece, squareName, transformEvent } from "./turnHelpers";

export function resolveCommit(state: GameState, action: Action): StatePatch {
  const { board, result } = applyAction(state.board, action, {
    movesThisTurn: state.movesThisTurn,
    kingMoved: state.kingMoved,
  });
  if (result.error) {
    return { message: result.error, selected: null, legalTargets: [] };
  }

  let currentPlayer = state.currentPlayer;
  let turnCounter = state.turnCounter;
  let victory = result.victory;
  let pendingTransform = transformEvent(result);
  let message = result.victory ? `${result.victory.winner} wins by ${result.victory.reason}.` : `${currentPlayer} to move.`;

  if (result.endsTurn) {
    const advanced = advanceHalfTurn(board, state);
    currentPlayer = advanced.currentPlayer;
    turnCounter = advanced.turnCounter;
    victory ??= advanced.victory;
    message = `${currentPlayer} to move.`;
  }

  if (pendingTransform) {
    pendingTransform = { ...pendingTransform, forceTurnSwitch: !result.endsTurn };
    message = `${pendingTransform.player}: choose a Transform for ${describePiece(pendingTransform.pieceType)} on ${squareName(pendingTransform.pos)}.`;
  }

  const lastAction = describeAction(action, action.defendedKing?.landingPosition ?? action.end ?? [0, 0]);
  const nextPhase = victory
    ? { phase: "gameOver", previousPhase: "playing" }
    : pendingTransform
      ? { phase: "transformSelection", previousPhase: "playing" }
      : state.phase.phase === "defenderSelection"
        ? { phase: "playing", previousPhase: "defenderSelection" }
        : state.phase;

  return {
    board,
    currentPlayer,
    movesThisTurn: result.endsTurn ? 0 : result.nextMovesThisTurn,
    kingMoved: result.endsTurn ? false : result.nextKingMoved,
    turnCounter,
    selected: null,
    legalTargets: [],
    pendingTransform,
    pendingDefendedKing: null,
    phase: nextPhase as PhaseState,
    history: [...state.history, createHistoryEntry(state)],
    lastAction,
    message: victory ? `${victory.winner} wins by ${victory.reason}.` : message,
  };
}
