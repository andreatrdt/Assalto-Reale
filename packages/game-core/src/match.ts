import { applyAction, buildAction } from "./actions.js";
import { cloneBoard, getPiece, hasPos, pieceIdAt } from "./board.js";
import { PAWN_TYPES } from "./config.js";
import { adjacentDefendersForKing } from "./defendedKing.js";
import {
  PLACEMENT_QUEUE,
  clonePiecesLeft,
  createBaseBoard,
  createEmptyPiecesLeft,
  createInitialPiecesLeft,
  createQuickBalancedBoard,
} from "./matchSetup.js";
import type {
  CommandError,
  CommandResult,
  CreateMatchOptions,
  GameCommand,
  MatchEvent,
  MatchState,
  PendingDecision,
  PendingDefendedKing,
  PendingTransform,
} from "./matchTypes.js";
import { canPlacePiece, placePiece } from "./placement.js";
import { refreshTerritoryClaim, updateControl } from "./territory.js";
import { ensureTransformSquare, transformPiece } from "./transform.js";
import type { Action, PawnType, Player, TransitionResult, Vec2, VictoryResult } from "./types.js";
import { evaluateVictory, opponent } from "./victory.js";

function cloneVec(pos: Vec2): Vec2 {
  return [pos[0], pos[1]];
}

function clonePreview(preview: NonNullable<Action["defendedKing"]>): NonNullable<Action["defendedKing"]> {
  return {
    ...preview,
    attackerOrigin: cloneVec(preview.attackerOrigin),
    kingPosition: cloneVec(preview.kingPosition),
    attackDirection: cloneVec(preview.attackDirection),
    bounceDirection: cloneVec(preview.bounceDirection),
    attackPath: preview.attackPath.map(cloneVec),
    bouncePath: preview.bouncePath.map(cloneVec),
    landingPosition: cloneVec(preview.landingPosition),
    routes: preview.routes.map((route) => ({
      ...route,
      path: route.path.map(cloneVec),
      jumpedSquares: route.jumpedSquares.map(cloneVec),
      turnSquares: route.turnSquares.map(cloneVec),
      landingPosition: cloneVec(route.landingPosition),
    })),
    eligibleDefenderIds: [...preview.eligibleDefenderIds],
  };
}

function cloneAction(action: Action): Action {
  return {
    ...action,
    start: action.start ? cloneVec(action.start) : undefined,
    end: action.end ? cloneVec(action.end) : undefined,
    selectedDefender: action.selectedDefender ? cloneVec(action.selectedDefender) : action.selectedDefender,
    selectedRouteId: action.selectedRouteId,
    defendedKing: action.defendedKing ? clonePreview(action.defendedKing) : action.defendedKing,
  };
}

function clonePendingDefendedKing(pending: PendingDefendedKing | null): PendingDefendedKing | null {
  return pending
    ? {
        owner: pending.owner,
        action: cloneAction(pending.action),
        preview: clonePreview(pending.preview),
        defenders: pending.defenders.map(cloneVec),
      }
    : null;
}

function clonePendingTransform(pending: PendingTransform | null): PendingTransform | null {
  return pending ? { ...pending, pos: cloneVec(pending.pos) } : null;
}

export function cloneMatchState(state: MatchState): MatchState {
  return {
    ...state,
    board: cloneBoard(state.board),
    currentPlacement: state.currentPlacement ? { ...state.currentPlacement } : null,
    piecesLeft: clonePiecesLeft(state.piecesLeft),
    pendingDefendedKing: clonePendingDefendedKing(state.pendingDefendedKing),
    pendingTransform: clonePendingTransform(state.pendingTransform),
    victory: state.victory ? { ...state.victory } : null,
  };
}

function failure(state: MatchState, command: GameCommand, code: CommandError["code"], message: string): CommandResult {
  return {
    ok: false,
    command,
    state: cloneMatchState(state),
    events: [],
    error: { code, message },
  };
}

function success(
  command: GameCommand,
  state: MatchState,
  events: MatchEvent[],
  options: { action?: Action; transition?: TransitionResult } = {},
): CommandResult {
  return {
    ok: true,
    command,
    state,
    events,
    ...options,
  };
}

export function createMatch(options: CreateMatchOptions): MatchState {
  const common = { rulesVersion: options.rulesVersion ?? 2, seed: options.seed } as const;
  if (options.placementMode === "QuickBalanced") {
    return {
      ...common,
      board: createQuickBalancedBoard(options.transformEnabled ?? false, options.seed),
      phase: "playing",
      currentPlayer: "Black",
      movesThisTurn: 0,
      kingMoved: false,
      turnCounter: 0,
      placementCursor: PLACEMENT_QUEUE.length,
      currentPlacement: null,
      piecesLeft: createEmptyPiecesLeft(),
      pendingDefendedKing: null,
      pendingTransform: null,
      victory: null,
    };
  }

  const currentPlacement = PLACEMENT_QUEUE[0] ?? null;
  return {
    ...common,
    board: createBaseBoard(options.transformEnabled ?? false, options.seed),
    phase: "placement",
    currentPlayer: currentPlacement?.player ?? "Black",
    movesThisTurn: 0,
    kingMoved: false,
    turnCounter: 0,
    placementCursor: 0,
    currentPlacement,
    piecesLeft: createInitialPiecesLeft(),
    pendingDefendedKing: null,
    pendingTransform: null,
    victory: null,
  };
}

export function getPendingDecision(state: MatchState): PendingDecision | null {
  if (state.pendingDefendedKing) {
    return { kind: "defendedKing", value: clonePendingDefendedKing(state.pendingDefendedKing)! };
  }
  if (state.pendingTransform) {
    return { kind: "transform", value: clonePendingTransform(state.pendingTransform)! };
  }
  return null;
}

export function getLegalActions(state: MatchState): Action[] {
  if (state.phase !== "playing" || state.victory) return [];

  const actions: Action[] = [];
  for (let row = 0; row < state.board.config.rows; row += 1) {
    for (let col = 0; col < state.board.config.cols; col += 1) {
      const start: Vec2 = [row, col];
      const piece = getPiece(state.board, start);
      if (piece?.player !== state.currentPlayer) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          const end: Vec2 = [row + dr, col + dc];
          const action = buildAction(state.board, start, end, {
            movesThisTurn: state.movesThisTurn,
            kingMoved: state.kingMoved,
            rulesVersion: state.rulesVersion,
          });
          if (!action.error && action.player === state.currentPlayer) {
            actions.push(action);
          }
        }
      }
    }
  }

  actions.push({
    kind: "pass",
    player: state.currentPlayer,
    cost: 0,
    capture: false,
    endsTurn: true,
  });
  return actions;
}

function transformEvent(result: TransitionResult): PendingTransform | null {
  const event = result.events.find((item) => item.kind === "transform_available");
  if (!event) return null;
  const player = event.data.player;
  const pos = event.data.at;
  const pieceType = event.data.piece_type;
  if (
    (player !== "Black" && player !== "White") ||
    !Array.isArray(pos) ||
    pos.length !== 2 ||
    !PAWN_TYPES.includes(pieceType as PawnType)
  ) {
    return null;
  }
  return {
    owner: player,
    player,
    pos: [Number(pos[0]), Number(pos[1])],
    pieceType: pieceType as PawnType,
    forceTurnSwitch: false,
  };
}

function advanceHalfTurnOnBoard(
  board: MatchState["board"],
  currentPlayer: Player,
  turnCounter: number,
): { currentPlayer: Player; turnCounter: number; victory: VictoryResult | null } {
  const nextTurnCounter = turnCounter + 1;
  ensureTransformSquare(board, nextTurnCounter, nextTurnCounter);
  const victory = refreshTerritoryClaim(board, nextTurnCounter);
  return {
    currentPlayer: opponent(currentPlayer),
    turnCounter: nextTurnCounter,
    victory,
  };
}

/**
 * Advance exactly one half-turn using the same Transform-square and territory
 * timing rules as committed actions and passes. The input is never mutated.
 */
export function advanceTurn(state: MatchState): MatchState {
  const next = cloneMatchState(state);
  if (next.phase === "gameOver" || next.victory) return next;
  const advanced = advanceHalfTurnOnBoard(next.board, next.currentPlayer, next.turnCounter);
  next.currentPlayer = advanced.currentPlayer;
  next.turnCounter = advanced.turnCounter;
  next.movesThisTurn = 0;
  next.kingMoved = false;
  next.victory = advanced.victory;
  if (advanced.victory) next.phase = "gameOver";
  return next;
}

export function checkVictory(state: MatchState): VictoryResult | null {
  if (state.victory) return { ...state.victory };
  const board = cloneBoard(state.board);
  return evaluateVictory(board, { turnCounter: state.turnCounter });
}

function appendOutcomeEvents(events: MatchEvent[], state: MatchState, turnChanged: boolean): void {
  if (turnChanged) {
    events.push({ type: "TurnChanged", player: state.currentPlayer, turnCounter: state.turnCounter });
  }
  if (state.victory) {
    events.push({ type: "MatchEnded", victory: { ...state.victory } });
  } else {
    const decision = getPendingDecision(state);
    if (decision) events.push({ type: "DecisionRequired", decision });
  }
}

function commitAction(state: MatchState, command: GameCommand, action: Action): CommandResult {
  const { board, result } = applyAction(state.board, action, {
    movesThisTurn: state.movesThisTurn,
    kingMoved: state.kingMoved,
    rulesVersion: state.rulesVersion,
  });
  if (result.error) {
    return failure(state, command, "illegal_action", result.error);
  }

  let currentPlayer = state.currentPlayer;
  let turnCounter = state.turnCounter;
  let victory = result.victory;
  let pendingTransform = transformEvent(result);
  let turnChanged = false;

  if (result.endsTurn) {
    const advanced = advanceHalfTurnOnBoard(board, state.currentPlayer, state.turnCounter);
    currentPlayer = advanced.currentPlayer;
    turnCounter = advanced.turnCounter;
    victory ??= advanced.victory;
    turnChanged = true;
  }

  if (pendingTransform) {
    pendingTransform = {
      ...pendingTransform,
      forceTurnSwitch: !result.endsTurn,
    };
  }

  const next: MatchState = {
    ...cloneMatchState(state),
    board,
    phase: victory ? "gameOver" : pendingTransform ? "transformSelection" : "playing",
    currentPlayer,
    movesThisTurn: result.endsTurn ? 0 : result.nextMovesThisTurn,
    kingMoved: result.endsTurn ? false : result.nextKingMoved,
    turnCounter,
    pendingDefendedKing: null,
    pendingTransform,
    victory,
  };

  const events: MatchEvent[] = [{ type: "ActionApplied", action: cloneAction(result.action), transition: result }];
  appendOutcomeEvents(events, next, turnChanged);
  return success(command, next, events, { action: result.action, transition: result });
}

function place(state: MatchState, command: Extract<GameCommand, { type: "PlacePiece" }>): CommandResult {
  if (state.phase === "gameOver" || state.victory) {
    return failure(state, command, "match_over", "The match has already ended.");
  }
  if (state.phase !== "placement") {
    return failure(state, command, "wrong_phase", "Pieces can only be placed during deployment.");
  }
  const item = PLACEMENT_QUEUE[state.placementCursor];
  if (!item || !state.currentPlacement) {
    return failure(state, command, "illegal_placement", "No placement is currently required.");
  }
  if (item.player !== state.currentPlayer || state.currentPlacement.player !== state.currentPlayer) {
    return failure(state, command, "wrong_player", "It is not this player's placement turn.");
  }
  const placement = canPlacePiece(state.board, command.position, item.player, item.pieceType);
  if (!placement.ok) {
    return failure(state, command, "illegal_placement", placement.reason ?? "Illegal placement.");
  }

  const next = cloneMatchState(state);
  placePiece(next.board, command.position, item.player, item.pieceType);
  next.piecesLeft[item.player][item.pieceType] -= 1;
  next.placementCursor += 1;
  next.currentPlacement = PLACEMENT_QUEUE[next.placementCursor] ?? null;
  next.currentPlayer = next.currentPlacement?.player ?? "Black";
  next.phase = next.currentPlacement ? "placement" : "playing";
  updateControl(next.board);

  return success(command, next, [
    {
      type: "PiecePlaced",
      player: item.player,
      pieceType: item.pieceType,
      position: cloneVec(command.position),
    },
  ]);
}

function submitAction(state: MatchState, command: Extract<GameCommand, { type: "SubmitAction" }>): CommandResult {
  if (state.phase === "gameOver" || state.victory) {
    return failure(state, command, "match_over", "The match has already ended.");
  }
  if (state.phase === "defenderSelection" || state.phase === "transformSelection") {
    return failure(state, command, "decision_required", "Resolve the pending decision before submitting another action.");
  }
  if (state.phase !== "playing") {
    return failure(state, command, "wrong_phase", "Actions can only be submitted during play.");
  }

  const piece = getPiece(state.board, command.start);
  if (!piece) return failure(state, command, "illegal_action", "No piece exists at the start square.");
  if (piece.player !== state.currentPlayer) {
    return failure(state, command, "wrong_player", "The selected piece does not belong to the current player.");
  }

  const action = buildAction(state.board, command.start, command.end, {
    movesThisTurn: state.movesThisTurn,
    kingMoved: state.kingMoved,
    selectedRouteId: command.routeId,
    rulesVersion: state.rulesVersion,
  });
  if (action.error) return failure(state, command, "illegal_action", action.error);
  if (action.player !== state.currentPlayer) {
    return failure(state, command, "wrong_player", "The action does not belong to the current player.");
  }

  if (action.defendedKing && action.defendedKing.routes.length > 1 && !command.routeId) {
    return failure(state, command, "invalid_decision", "Select one of the authoritative deflection routes.");
  }

  if (action.defendedKing?.pathDefenderId && !action.selectedDefender) {
    const defender = adjacentDefendersForKing(state.board, command.end, opponent(action.player as Player)).find(
      (pos) => pieceIdAt(state.board, pos) === action.defendedKing?.pathDefenderId,
    );
    if (!defender) return failure(state, command, "invalid_decision", "The path defender is no longer available.");
    return commitAction(state, command, { ...action, selectedDefender: defender });
  }

  if (action.defendedKing && !action.selectedDefender) {
    const king = action.end ? getPiece(state.board, action.end) : null;
    const defenders = action.end && king ? adjacentDefendersForKing(state.board, action.end, king.player) : [];
    if (defenders.length === 0) {
      return failure(state, command, "invalid_decision", "The defended King no longer has an eligible defender.");
    }
    const owner = opponent(action.player as Player);
    const pending: PendingDefendedKing = {
      owner,
      action: cloneAction(action),
      preview: action.defendedKing,
      defenders: defenders.map(cloneVec),
    };
    const next = cloneMatchState(state);
    next.phase = "defenderSelection";
    next.pendingDefendedKing = pending;
    next.pendingTransform = null;
    return success(command, next, [{ type: "DecisionRequired", decision: { kind: "defendedKing", value: pending } }], {
      action,
    });
  }

  return commitAction(state, command, action);
}

function chooseDefender(state: MatchState, command: Extract<GameCommand, { type: "ChooseDefender" }>): CommandResult {
  if (state.phase !== "defenderSelection" || !state.pendingDefendedKing) {
    return failure(state, command, "wrong_phase", "No Defended King decision is pending.");
  }
  if (!hasPos(state.pendingDefendedKing.defenders, command.position)) {
    return failure(state, command, "invalid_decision", "The selected piece is not an eligible Defense Pawn.");
  }
  return commitAction(state, command, {
    ...cloneAction(state.pendingDefendedKing.action),
    selectedDefender: cloneVec(command.position),
  });
}

function cancelDefendedKing(state: MatchState, command: Extract<GameCommand, { type: "CancelDefendedKing" }>): CommandResult {
  if (state.phase !== "defenderSelection" || !state.pendingDefendedKing) {
    return failure(state, command, "wrong_phase", "No Defended King decision is pending.");
  }
  const next = cloneMatchState(state);
  next.phase = "playing";
  next.pendingDefendedKing = null;
  return success(command, next, [{ type: "DecisionCancelled", decision: "defendedKing" }]);
}

function chooseTransform(state: MatchState, command: Extract<GameCommand, { type: "ChooseTransform" }>): CommandResult {
  if (state.phase !== "transformSelection" || !state.pendingTransform) {
    return failure(state, command, "wrong_phase", "No Transform decision is pending.");
  }
  if (command.newType === state.pendingTransform.pieceType) {
    return failure(state, command, "invalid_decision", "A pawn must transform into a different pawn type.");
  }

  const { board, result } = transformPiece(
    state.board,
    state.pendingTransform.pos,
    command.newType,
    state.rulesVersion === 1 ? state.turnCounter + 1 : state.seed ^ Math.imul(state.turnCounter + 1, 0x9e3779b1),
    state.rulesVersion,
  );
  if (result.error) return failure(state, command, "invalid_decision", result.error);

  let currentPlayer = state.currentPlayer;
  let turnCounter = state.turnCounter;
  let victory = result.victory;
  let turnChanged = false;
  if (state.pendingTransform.forceTurnSwitch) {
    const advanced = advanceHalfTurnOnBoard(board, state.currentPlayer, state.turnCounter);
    currentPlayer = advanced.currentPlayer;
    turnCounter = advanced.turnCounter;
    victory ??= advanced.victory;
    turnChanged = true;
  }

  const next: MatchState = {
    ...cloneMatchState(state),
    board,
    phase: victory ? "gameOver" : "playing",
    currentPlayer,
    movesThisTurn: 0,
    kingMoved: false,
    turnCounter,
    pendingDefendedKing: null,
    pendingTransform: null,
    victory,
  };
  const events: MatchEvent[] = [{ type: "ActionApplied", action: cloneAction(result.action), transition: result }];
  appendOutcomeEvents(events, next, turnChanged);
  return success(command, next, events, { action: result.action, transition: result });
}

function passTurn(state: MatchState, command: Extract<GameCommand, { type: "PassTurn" }>): CommandResult {
  if (state.phase === "gameOver" || state.victory) {
    return failure(state, command, "match_over", "The match has already ended.");
  }
  if (state.phase === "defenderSelection" || state.phase === "transformSelection") {
    return failure(state, command, "decision_required", "Resolve the pending decision before passing.");
  }
  if (state.phase !== "playing") {
    return failure(state, command, "wrong_phase", "A turn can only be passed during play.");
  }
  const action: Action = {
    kind: "pass",
    player: state.currentPlayer,
    cost: 0,
    capture: false,
    endsTurn: true,
  };
  return commitAction(state, command, action);
}

export function applyCommand(state: MatchState, command: GameCommand): CommandResult {
  switch (command.type) {
    case "PlacePiece":
      return place(state, command);
    case "SubmitAction":
      return submitAction(state, command);
    case "ChooseDefender":
      return chooseDefender(state, command);
    case "CancelDefendedKing":
      return cancelDefendedKing(state, command);
    case "ChooseTransform":
      return chooseTransform(state, command);
    case "PassTurn":
      return passTurn(state, command);
  }
}

export function resolveDefendedKing(state: MatchState, position: Vec2): CommandResult {
  return applyCommand(state, { type: "ChooseDefender", position });
}

export function resolveTransform(state: MatchState, newType: PawnType): CommandResult {
  return applyCommand(state, { type: "ChooseTransform", newType });
}
