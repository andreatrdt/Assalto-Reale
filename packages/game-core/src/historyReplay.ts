import { applyCommand, cloneMatchState, createMatch } from "./match.js";
import type { GameCommand, MatchEvent, MatchState, PlacementMode } from "./matchTypes.js";
import type { PawnType, Player, Vec2 } from "./types.js";

export const GAME_RULES_VERSION = 1 as const;
export const REPLAY_SCHEMA_VERSION = 1 as const;

export type HistoricalCommandV1 =
  | { type: "PlacePiece"; position: Vec2 }
  | { type: "SubmitAction"; start: Vec2; end: Vec2 }
  | { type: "ChooseDefender"; position: Vec2 }
  | { type: "CancelDefendedKing" }
  | { type: "ChooseTransform"; newType: PawnType }
  | { type: "PassTurn" }
  | { type: "Resign" };

export interface HistoricalReplayEventV1 {
  sequenceNumber: number;
  actorSide: Player | null;
  payload: {
    schemaVersion: number;
    command: HistoricalCommandV1;
  };
}

export interface HistoricalReplayInput {
  rulesVersion: number;
  replaySchemaVersion: number;
  seed: number;
  placementMode: PlacementMode;
  transformEnabled: boolean;
  events: HistoricalReplayEventV1[];
}

export interface HistoricalReplayFrame {
  sequenceNumber: number;
  command: HistoricalCommandV1 | null;
  state: MatchState;
  events: MatchEvent[];
  terminal: { winner: Player | null; loser: Player | null; reason: "king_capture" | "territory" | "timeout" | "resignation" } | null;
}

export type HistoricalReplayResult =
  | { ok: true; frames: HistoricalReplayFrame[] }
  | { ok: false; code: "unsupported_rules_version" | "unsupported_replay_schema" | "invalid_replay"; message: string };

function expectedActor(state: MatchState, command: HistoricalCommandV1): Player {
  if (command.type === "ChooseDefender" || command.type === "CancelDefendedKing") {
    return state.pendingDefendedKing?.owner ?? state.currentPlayer;
  }
  if (command.type === "ChooseTransform") {
    return state.pendingTransform?.owner ?? state.currentPlayer;
  }
  return state.currentPlayer;
}

/** Reconstruct a schema-v1 replay exclusively through the versioned game-core API. */
export function replayHistoricalMatch(input: HistoricalReplayInput): HistoricalReplayResult {
  if (input.rulesVersion !== GAME_RULES_VERSION) {
    return {
      ok: false,
      code: "unsupported_rules_version",
      message: `Replay requires rules version ${input.rulesVersion}; this client supports ${GAME_RULES_VERSION}.`,
    };
  }
  if (input.replaySchemaVersion !== REPLAY_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "unsupported_replay_schema",
      message: `Replay schema ${input.replaySchemaVersion} is not supported.`,
    };
  }

  let state = createMatch({
    placementMode: input.placementMode,
    transformEnabled: input.transformEnabled,
    seed: input.seed,
  });
  const frames: HistoricalReplayFrame[] = [{ sequenceNumber: 0, command: null, state: cloneMatchState(state), events: [], terminal: null }];

  for (let index = 0; index < input.events.length; index += 1) {
    const event = input.events[index]!;
    const expectedSequence = index + 1;
    if (event.sequenceNumber !== expectedSequence || event.payload.schemaVersion !== REPLAY_SCHEMA_VERSION) {
      return {
        ok: false,
        code: "invalid_replay",
        message: `Replay event ${expectedSequence} is missing, duplicated, or uses an incompatible schema.`,
      };
    }
    const command = event.payload.command;
    if (!event.actorSide || event.actorSide !== expectedActor(state, command)) {
      return {
        ok: false,
        code: "invalid_replay",
        message: `Replay event ${expectedSequence} has an invalid authoritative actor.`,
      };
    }
    if (command.type === "Resign") {
      frames.push({
        sequenceNumber: event.sequenceNumber,
        command,
        state: cloneMatchState(state),
        events: [],
        terminal: {
          winner: event.actorSide === "Black" ? "White" : "Black",
          loser: event.actorSide,
          reason: "resignation",
        },
      });
      if (index !== input.events.length - 1) {
        return { ok: false, code: "invalid_replay", message: "A resignation must be the final replay event." };
      }
      continue;
    }

    const result = applyCommand(state, command as GameCommand);
    if (!result.ok) {
      return {
        ok: false,
        code: "invalid_replay",
        message: `Replay event ${expectedSequence} is not legal under rules version ${GAME_RULES_VERSION}: ${result.error.message}`,
      };
    }
    state = result.state;
    frames.push({
      sequenceNumber: event.sequenceNumber,
      command,
      state: cloneMatchState(state),
      events: result.events,
      terminal: state.victory
        ? {
            winner: state.victory.winner,
            loser: state.victory.loser ?? null,
            reason: state.victory.reason,
          }
        : null,
    });
  }

  return { ok: true, frames };
}
