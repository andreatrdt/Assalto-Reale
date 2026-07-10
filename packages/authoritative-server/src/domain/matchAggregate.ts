import {
  applyCommand,
  cloneMatchState,
  createMatch as coreCreateMatch,
  opponent,
  type GameCommand,
  type MatchState,
} from "@assalto-reale/game-core";
import type {
  CanonicalMatchSnapshot,
  CommandRejectionCode,
  MatchEndReason,
  OnlineMatchConfig,
  PlayerSide,
  ServerEvent,
} from "@assalto-reale/multiplayer-protocol";
import {
  coreEventToJson,
  isProtocolGameCommand,
  pendingDecisionToWire,
  rejectionForCoreError,
  snapshotOf,
  toCoreCommand,
  victoryToEnd,
  type ProtocolGameCommand,
} from "../protocol/translate.js";

export type MatchStatus = "awaitingOpponent" | "active" | "ended";

export interface MatchMembers {
  Black: string | null;
  White: string | null;
}

/**
 * The canonical server-side match. Holds the game-core `MatchState` plus the
 * authoritative metadata the server owns: monotonic version and stream
 * sequence, membership, server-generated seed, invite code and lifecycle.
 */
export interface MatchAggregate {
  matchId: string;
  inviteCode: string;
  version: number;
  streamSequence: number;
  seed: number;
  config: OnlineMatchConfig;
  members: MatchMembers;
  status: MatchStatus;
  state: MatchState;
  endReason: MatchEndReason | null;
}

export interface Emission {
  event: ServerEvent;
  recipient: "all" | { playerId: string };
  matchVersion: number;
  streamSequence: number;
}

export type OperationOutcome =
  | { ok: true; aggregate: MatchAggregate; emissions: Emission[] }
  | { ok: false; code: CommandRejectionCode; message: string; version: number | null; snapshot: CanonicalMatchSnapshot | null };

export function memberSide(aggregate: MatchAggregate, playerId: string): PlayerSide | null {
  if (aggregate.members.Black === playerId) return "Black";
  if (aggregate.members.White === playerId) return "White";
  return null;
}

function cloneAggregate(aggregate: MatchAggregate): MatchAggregate {
  return {
    ...aggregate,
    members: { ...aggregate.members },
    state: cloneMatchState(aggregate.state),
  };
}

/** Deterministic side for a "Random" preference, derived from the server seed. */
function resolvePreferredSide(config: OnlineMatchConfig, seed: number): PlayerSide {
  if (config.preferredSide === "Black" || config.preferredSide === "White") return config.preferredSide;
  return (seed >>> 0) % 2 === 0 ? "Black" : "White";
}

export interface CreateMatchInput {
  matchId: string;
  inviteCode: string;
  seed: number;
  config: OnlineMatchConfig;
  creatorPlayerId: string;
}

export function createMatchAggregate(input: CreateMatchInput): { aggregate: MatchAggregate; emissions: Emission[] } {
  const state = coreCreateMatch({
    placementMode: input.config.placementMode,
    transformEnabled: input.config.transformEnabled,
    seed: input.seed,
  });
  const creatorSide = resolvePreferredSide(input.config, input.seed);
  const members: MatchMembers = { Black: null, White: null };
  members[creatorSide] = input.creatorPlayerId;

  const aggregate: MatchAggregate = {
    matchId: input.matchId,
    inviteCode: input.inviteCode,
    version: 1,
    streamSequence: 1,
    seed: input.seed,
    config: input.config,
    members,
    status: "awaitingOpponent",
    state,
    endReason: null,
  };

  const emissions: Emission[] = [
    {
      event: { type: "MatchCreated", inviteCode: input.inviteCode, assignedSide: creatorSide, snapshot: snapshotOf(state) },
      recipient: { playerId: input.creatorPlayerId },
      matchVersion: aggregate.version,
      streamSequence: aggregate.streamSequence,
    },
  ];
  return { aggregate, emissions };
}

export function joinMatchAggregate(aggregate: MatchAggregate, joinerPlayerId: string): OperationOutcome {
  if (memberSide(aggregate, joinerPlayerId)) {
    return reject(aggregate, "match_full", "This player is already a member of the match.");
  }
  const openSide: PlayerSide | null = aggregate.members.Black === null ? "Black" : aggregate.members.White === null ? "White" : null;
  if (!openSide) {
    return reject(aggregate, "match_full", "The match already has two players.");
  }

  const next = cloneAggregate(aggregate);
  next.members[openSide] = joinerPlayerId;
  next.status = "active";
  next.version += 1;
  next.streamSequence += 1;

  return {
    ok: true,
    aggregate: next,
    emissions: [
      {
        event: { type: "PlayerJoined", playerId: joinerPlayerId, assignedSide: openSide, snapshot: snapshotOf(next.state) },
        recipient: "all",
        matchVersion: next.version,
        streamSequence: next.streamSequence,
      },
    ],
  };
}

/** The side that must own the actor for a given game command in the current state. */
function requiredActorSide(state: MatchState, command: ProtocolGameCommand): PlayerSide {
  if (command.type === "ChooseDefender" || command.type === "CancelDefendedKing") {
    return state.pendingDefendedKing?.owner ?? state.currentPlayer;
  }
  if (command.type === "ChooseTransform") {
    return state.pendingTransform?.owner ?? state.currentPlayer;
  }
  return state.currentPlayer;
}

export function applyGameCommand(aggregate: MatchAggregate, actorSide: PlayerSide, command: ProtocolGameCommand): OperationOutcome {
  if (aggregate.status === "ended" || aggregate.state.phase === "gameOver") {
    return reject(aggregate, "match_ended", "The match has already ended.");
  }
  if (actorSide !== requiredActorSide(aggregate.state, command)) {
    return reject(aggregate, "not_your_turn", "It is not this player's turn to act.");
  }

  const coreCommand: GameCommand = toCoreCommand(command);
  const result = applyCommand(aggregate.state, coreCommand);
  if (!result.ok) {
    return reject(aggregate, rejectionForCoreError(result.error.code), result.error.message);
  }

  const next = cloneAggregate(aggregate);
  next.state = result.state;
  next.version += 1;
  if (result.state.phase === "gameOver" && result.state.victory) {
    next.status = "ended";
    next.endReason = result.state.victory.reason;
  }

  const snapshot = snapshotOf(next.state);
  const emissions: Emission[] = [];
  const emit = (event: ServerEvent, recipient: Emission["recipient"] = "all"): void => {
    next.streamSequence += 1;
    emissions.push({ event, recipient, matchVersion: next.version, streamSequence: next.streamSequence });
  };

  emit({ type: "MatchUpdated", snapshot, domainEvents: result.events.map(coreEventToJson) });
  for (const event of result.events) {
    if (event.type === "TurnChanged") {
      emit({ type: "TurnChanged", currentPlayer: event.player });
    } else if (event.type === "DecisionRequired") {
      emit({ type: "DecisionRequired", decision: pendingDecisionToWire(event.decision) });
    } else if (event.type === "MatchEnded") {
      emit({ type: "MatchEnded", ...victoryToEnd(event.victory), snapshot });
    }
  }

  return { ok: true, aggregate: next, emissions };
}

export function resignAggregate(aggregate: MatchAggregate, actorSide: PlayerSide): OperationOutcome {
  if (aggregate.status === "ended" || aggregate.state.phase === "gameOver") {
    return reject(aggregate, "match_ended", "The match has already ended.");
  }
  const next = cloneAggregate(aggregate);
  next.status = "ended";
  next.endReason = "resignation";
  next.version += 1;
  next.streamSequence += 1;

  const winner = opponent(actorSide);
  return {
    ok: true,
    aggregate: next,
    emissions: [
      {
        event: { type: "MatchEnded", winner, loser: actorSide, reason: "resignation", snapshot: snapshotOf(next.state) },
        recipient: "all",
        matchVersion: next.version,
        streamSequence: next.streamSequence,
      },
    ],
  };
}

/** A read-only canonical snapshot for RequestSync; never mutates the aggregate. */
export function syncEmission(aggregate: MatchAggregate, requesterPlayerId: string): Emission {
  return {
    event: { type: "MatchSnapshot", snapshot: snapshotOf(aggregate.state) },
    recipient: { playerId: requesterPlayerId },
    matchVersion: aggregate.version,
    streamSequence: aggregate.streamSequence,
  };
}

function reject(aggregate: MatchAggregate | null, code: CommandRejectionCode, message: string): OperationOutcome {
  return {
    ok: false,
    code,
    message,
    version: aggregate ? aggregate.version : null,
    snapshot: aggregate ? snapshotOf(aggregate.state) : null,
  };
}

// Re-export the guard so the handler can classify commands without importing the
// translate module directly.
export { isProtocolGameCommand };
