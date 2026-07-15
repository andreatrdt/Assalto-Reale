import {
  PAWN_TYPES,
  serializeState,
  type CommandError,
  type GameCommand,
  type MatchEvent,
  type MatchState,
  type PawnType,
  type PendingDecision,
  type Vec2,
  type VictoryResult,
} from "@assalto-reale/game-core";
import type {
  CanonicalMatchSnapshot,
  ClientCommand,
  CommandRejectionCode,
  Coordinate,
  JsonObject,
  MatchEndReason,
  PendingDecisionWire,
  PlayerSide,
} from "@assalto-reale/multiplayer-protocol";

/** Protocol commands that map directly onto a game-core command. */
export type ProtocolGameCommand = Extract<
  ClientCommand,
  {
    type:
      | "PlacePiece"
      | "SubmitAction"
      | "ChooseDefender"
      | "CancelDefendedKing"
      | "ActivateTransform"
      | "ChooseTransform"
      | "DeclineTransform"
      | "PassTurn";
  }
>;

export function isProtocolGameCommand(
  command: ClientCommand,
): command is ProtocolGameCommand {
  switch (command.type) {
    case "PlacePiece":
    case "SubmitAction":
    case "ChooseDefender":
    case "CancelDefendedKing":
    case "ActivateTransform":
    case "ChooseTransform":
    case "DeclineTransform":
    case "PassTurn":
      return true;
    default:
      return false;
  }
}

/** Translate a validated protocol game command into a game-core command. */
export function toCoreCommand(command: ProtocolGameCommand): GameCommand {
  switch (command.type) {
    case "PlacePiece":
      return { type: "PlacePiece", position: command.position };
    case "SubmitAction":
      return {
        type: "SubmitAction",
        start: command.start,
        end: command.end,
        routeId: command.routeId,
      };
    case "ChooseDefender":
      return { type: "ChooseDefender", position: command.position };
    case "CancelDefendedKing":
      return { type: "CancelDefendedKing" };
    case "ActivateTransform":
      return { type: "ActivateTransform", position: command.position };
    case "ChooseTransform":
      return { type: "ChooseTransform", newType: command.newType };
    case "DeclineTransform":
      return { type: "DeclineTransform" };
    case "PassTurn":
      return { type: "PassTurn" };
  }
}

/** Map a game-core rejection code onto the protocol wire rejection code. */
export function rejectionForCoreError(
  code: CommandError["code"],
): CommandRejectionCode {
  switch (code) {
    case "wrong_player":
      return "not_your_turn";
    case "decision_required":
      return "decision_required";
    case "match_over":
      return "match_ended";
    case "wrong_phase":
    case "illegal_placement":
    case "illegal_action":
    case "invalid_decision":
      return "illegal_command";
  }
}

function coordinate(pos: Vec2): Coordinate {
  return [pos[0], pos[1]];
}

/** Canonical, plain-JSON snapshot for the wire (schema 1). */
export function snapshotOf(state: MatchState): CanonicalMatchSnapshot {
  return JSON.parse(serializeState(state)) as CanonicalMatchSnapshot;
}

export function pendingDecisionToWire(
  decision: PendingDecision,
): PendingDecisionWire {
  if (decision.kind === "defendedKing") {
    const { value } = decision;
    return {
      kind: "defendedKing",
      owner: value.owner,
      defenders: value.defenders.map(coordinate),
      attackerOrigin: coordinate(value.preview.attackerOrigin),
      kingPosition: coordinate(value.preview.kingPosition),
      landingPosition: coordinate(value.preview.landingPosition),
      routes: value.preview.routes.map((route) => ({
        id: route.id,
        path: route.path.map(coordinate),
        jumpedSquares: route.jumpedSquares.map(coordinate),
        turnSquares: route.turnSquares.map(coordinate),
        landingPosition: coordinate(route.landingPosition),
      })),
      pathDefender: null,
    };
  }
  const { value } = decision;
  return {
    kind: "transform",
    owner: value.owner,
    position: coordinate(value.pos),
    currentType: value.pieceType,
    options: PAWN_TYPES.filter(
      (type): type is PawnType => type !== value.pieceType,
    ).map((type) => type),
  };
}

/** Serialise a core domain event into a plain JSON object for MatchUpdated. */
export function coreEventToJson(event: MatchEvent): JsonObject {
  return JSON.parse(JSON.stringify(event)) as JsonObject;
}

export interface MatchEndInfo {
  winner: PlayerSide;
  loser: PlayerSide | null;
  reason: MatchEndReason;
}

export function victoryToEnd(victory: VictoryResult): MatchEndInfo {
  return {
    winner: victory.winner,
    loser: victory.loser ?? null,
    reason: victory.reason,
  };
}
