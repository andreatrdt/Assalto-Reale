import type { GamePhase, PhaseState } from "../../app/phases";
import {
  applyCommand,
  createMatch,
  type CommandResult,
  type CreateMatchOptions,
  type GameCommand,
  type MatchPhase,
  type MatchState,
  type Player,
  type Vec2,
} from "../engine";
import { createHistoryEntry } from "../history/historyController";
import type { GameState, StatePatch } from "../state/storeTypes";
import { actionTargets, describeAction, describePiece, squareName } from "../turn/turnHelpers";

const MATCH_PHASES = new Set<MatchPhase>(["placement", "playing", "defenderSelection", "transformSelection", "gameOver"]);

export function toCoreMatchState(state: GameState): MatchState {
  const phase = MATCH_PHASES.has(state.phase.phase as MatchPhase) ? (state.phase.phase as MatchPhase) : "playing";
  return {
    rulesVersion: state.rulesVersion,
    seed: state.seed,
    board: state.board,
    phase,
    currentPlayer: state.currentPlayer,
    movesThisTurn: state.movesThisTurn,
    kingMoved: state.kingMoved,
    turnCounter: state.turnCounter,
    placementCursor: state.placementCursor,
    currentPlacement: state.currentPlacement,
    piecesLeft: state.piecesLeft,
    pendingDefendedKing: state.pendingDefendedKing,
    pendingTransform: state.pendingTransform,
    // Browser-only timeout victories are represented by PhaseState/message and
    // never sent back through the command reducer. Rule victories produced by a
    // command are returned by the core itself.
    victory: null,
  };
}

export function createMatchState(options: CreateMatchOptions): MatchState {
  return createMatch(options);
}

function phaseAfterCommand(before: GameState, command: GameCommand, result: Extract<CommandResult, { ok: true }>): PhaseState {
  const phase = result.state.phase;
  switch (command.type) {
    case "PlacePiece":
      return phase === "placement" ? before.phase : { phase: "playing", previousPhase: "placement" };
    case "SubmitAction":
      if (phase === "defenderSelection") return { phase, previousPhase: "playing" };
      if (phase === "transformSelection") return { phase, previousPhase: "playing" };
      if (phase === "gameOver") return { phase, previousPhase: "playing" };
      return before.phase.phase === "playing" ? before.phase : { phase: "playing", previousPhase: before.phase.phase };
    case "ChooseDefender":
      if (phase === "transformSelection") return { phase, previousPhase: "playing" };
      if (phase === "gameOver") return { phase, previousPhase: "playing" };
      return { phase: "playing", previousPhase: "defenderSelection" };
    case "CancelDefendedKing":
      return { phase: "playing", previousPhase: "defenderSelection" };
    case "ActivateTransform":
      return { phase: "transformSelection", previousPhase: "playing" };
    case "ChooseTransform":
      return { phase: phase as "playing" | "gameOver", previousPhase: "transformSelection" };
    case "DeclineTransform":
      return { phase: "playing", previousPhase: "transformSelection" };
    case "PassTurn":
      return phase === "gameOver" ? { phase, previousPhase: "playing" } : before.phase;
  }
}

function shouldPushHistory(command: GameCommand, result: Extract<CommandResult, { ok: true }>): boolean {
  if (
    command.type === "PlacePiece" ||
    command.type === "ChooseDefender" ||
    command.type === "ChooseTransform" ||
    command.type === "PassTurn"
  )
    return true;
  return command.type === "SubmitAction" && result.transition !== undefined;
}

function outcomeMessage(result: Extract<CommandResult, { ok: true }>): string {
  if (result.state.victory) {
    return `${result.state.victory.winner} wins by ${result.state.victory.reason}.`;
  }
  if (result.state.pendingTransform) {
    const pending = result.state.pendingTransform;
    return `${pending.player}: choose a Transform for ${describePiece(pending.pieceType)} on ${squareName(pending.pos)}.`;
  }
  return `${result.state.currentPlayer} to move.`;
}

function successPatch(
  before: GameState,
  command: GameCommand,
  result: Extract<CommandResult, { ok: true }>,
  historySource: GameState,
): StatePatch {
  const after = result.state;
  const patch: StatePatch = {
    board: after.board,
    currentPlayer: after.currentPlayer,
    movesThisTurn: after.movesThisTurn,
    kingMoved: after.kingMoved,
    turnCounter: after.turnCounter,
    placementCursor: after.placementCursor,
    currentPlacement: after.currentPlacement,
    piecesLeft: after.piecesLeft,
    pendingDefendedKing: after.pendingDefendedKing,
    pendingTransform: after.pendingTransform,
    phase: phaseAfterCommand(before, command, result),
    resolvedDefendedKing: null,
  };

  if (shouldPushHistory(command, result)) {
    patch.history = [...historySource.history, createHistoryEntry(historySource)];
  }

  switch (command.type) {
    case "PlacePiece": {
      const event = result.events.find((item) => item.type === "PiecePlaced");
      if (!event || event.type !== "PiecePlaced") return patch;
      patch.selected = null;
      patch.legalTargets = [];
      patch.lastAction = `${event.player} placed ${describePiece(event.pieceType)} on ${squareName(event.position)}.`;
      patch.message = after.currentPlacement
        ? `${after.currentPlacement.player}: place ${describePiece(after.currentPlacement.pieceType)}.`
        : "Deployment complete. Black to move.";
      return patch;
    }
    case "SubmitAction": {
      if (after.pendingDefendedKing && !result.transition) {
        const pending = after.pendingDefendedKing;
        patch.selected = result.action?.end ?? before.selected;
        patch.legalTargets = pending.defenders;
        patch.message =
          pending.defenders.length === 1
            ? `${pending.owner}: confirm the highlighted Defense Pawn sacrifice.`
            : `${pending.owner}: choose a Defense Pawn to sacrifice.`;
        return patch;
      }
      patch.selected = null;
      patch.legalTargets = [];
      if (result.action) {
        patch.lastAction = describeAction(result.action, result.action.defendedKing?.landingPosition ?? result.action.end ?? [0, 0]);
        if (result.action.defendedKing) {
          const defended = result.transition?.events.find((event) => event.kind === "defended_king");
          const defender = defended?.data.defender;
          patch.resolvedDefendedKing = {
            action: result.action,
            defenders: Array.isArray(defender) && defender.length === 2 ? [defender as unknown as Vec2] : [],
          };
        }
      }
      patch.message = outcomeMessage(result);
      return patch;
    }
    case "ChooseDefender":
      patch.selected = null;
      patch.legalTargets = [];
      if (result.action) {
        patch.lastAction = describeAction(result.action, result.action.defendedKing?.landingPosition ?? result.action.end ?? [0, 0]);
      }
      patch.message = outcomeMessage(result);
      return patch;
    case "CancelDefendedKing": {
      const start = before.pendingDefendedKing?.action.start ?? null;
      patch.selected = start;
      patch.legalTargets = start ? actionTargets(before.board, start, before.movesThisTurn, before.kingMoved, before.rulesVersion) : [];
      patch.message = "Defended-King attack cancelled.";
      return patch;
    }
    case "ActivateTransform":
      patch.selected = command.position;
      patch.legalTargets = [];
      patch.message = "Choose a new pawn type on the board, or ignore the Transform Square.";
      return patch;
    case "ChooseTransform": {
      const pending = before.pendingTransform;
      if (pending) {
        patch.lastAction = `${pending.player} transformed into ${describePiece(command.newType)} on ${squareName(pending.pos)}.`;
      }
      patch.message = outcomeMessage(result);
      return patch;
    }
    case "DeclineTransform":
      patch.selected = before.pendingTransform?.pos ?? null;
      patch.legalTargets = patch.selected
        ? actionTargets(after.board, patch.selected, after.movesThisTurn, after.kingMoved, after.rulesVersion)
        : [];
      patch.message = "Transform ignored. Continue using the remaining actions.";
      return patch;
    case "PassTurn":
      patch.selected = null;
      patch.legalTargets = [];
      patch.lastAction = `${before.currentPlayer} passed.`;
      patch.message = outcomeMessage(result);
      return patch;
  }
}

export interface StoreCommandResult {
  result: CommandResult;
  patch: StatePatch;
}

export function runStoreCommand(
  state: GameState,
  command: GameCommand,
  options: { historySource?: GameState; phaseCommand?: GameCommand } = {},
): StoreCommandResult {
  const result = applyCommand(toCoreMatchState(state), command);
  if (!result.ok) {
    const clearSelection = command.type === "SubmitAction";
    return {
      result,
      patch: {
        message: result.error.message,
        ...(clearSelection ? { selected: null, legalTargets: [] } : {}),
      },
    };
  }
  const phaseCommand = options.phaseCommand ?? command;
  return {
    result,
    patch: successPatch(state, phaseCommand, { ...result, command: phaseCommand }, options.historySource ?? state),
  };
}

export function runStoreSubmittedAction(
  state: GameState,
  start: Vec2,
  end: Vec2,
  autoResolveDefenderFor?: Player,
  routeId?: import("../engine").DeflectionRouteId,
): StoreCommandResult {
  const command: GameCommand = { type: "SubmitAction", start, end, routeId };
  const submitted = applyCommand(toCoreMatchState(state), command);
  if (!submitted.ok || !autoResolveDefenderFor || submitted.state.pendingDefendedKing?.owner !== autoResolveDefenderFor) {
    if (!submitted.ok) {
      return {
        result: submitted,
        patch: { message: submitted.error.message, selected: null, legalTargets: [] },
      };
    }
    return {
      result: submitted,
      patch: successPatch(state, command, submitted, state),
    };
  }

  const defender = submitted.state.pendingDefendedKing.defenders[0];
  if (!defender) {
    return {
      result: submitted,
      patch: successPatch(state, command, submitted, state),
    };
  }
  const resolved = applyCommand(submitted.state, { type: "ChooseDefender", position: defender });
  if (!resolved.ok) {
    return {
      result: resolved,
      patch: { message: resolved.error.message, selected: null, legalTargets: [] },
    };
  }
  const composite: Extract<CommandResult, { ok: true }> = {
    ...resolved,
    command,
  };
  return {
    result: composite,
    patch: successPatch(state, command, composite, state),
  };
}

export function storePatchFromCoreMatch(
  match: MatchState,
  previousPhase: GamePhase,
): Pick<
  GameState,
  | "rulesVersion"
  | "seed"
  | "phase"
  | "board"
  | "currentPlayer"
  | "movesThisTurn"
  | "kingMoved"
  | "turnCounter"
  | "selected"
  | "legalTargets"
  | "placementCursor"
  | "currentPlacement"
  | "piecesLeft"
  | "history"
  | "pendingTransform"
  | "pendingDefendedKing"
  | "resolvedDefendedKing"
> {
  return {
    rulesVersion: match.rulesVersion,
    seed: match.seed,
    phase: { phase: match.phase, previousPhase },
    board: match.board,
    currentPlayer: match.currentPlayer,
    movesThisTurn: match.movesThisTurn,
    kingMoved: match.kingMoved,
    turnCounter: match.turnCounter,
    selected: null,
    legalTargets: [],
    placementCursor: match.placementCursor,
    currentPlacement: match.currentPlacement,
    piecesLeft: match.piecesLeft,
    history: [],
    pendingTransform: match.pendingTransform,
    pendingDefendedKing: match.pendingDefendedKing,
    resolvedDefendedKing: null,
  };
}
