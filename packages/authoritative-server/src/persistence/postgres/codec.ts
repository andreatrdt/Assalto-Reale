import {
  deserializeState,
  serializeState,
} from "@assalto-reale/game-core";
import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  validateClientMessage,
  validateServerMessage,
  type MatchEndReason,
  type OnlineMatchConfig,
  type ServerEventEnvelope,
} from "@assalto-reale/multiplayer-protocol";
import type {
  MatchAggregate,
  MatchStatus,
} from "../../domain/matchAggregate.js";
import type { StoredCommandReceipt } from "../../repositories.js";

export interface PostgresMatchRow {
  match_id: string;
  invite_code: string;
  version: number | string;
  stream_sequence: number | string;
  seed: number | string;
  config: unknown;
  black_player_id: string | null;
  white_player_id: string | null;
  status: string;
  state: unknown;
  end_reason: string | null;
}

export interface PostgresReceiptRow {
  command_id: string;
  player_id: string;
  match_id: string | null;
  payload_hash: string;
  envelopes: unknown;
}

export interface EncodedMatchAggregate {
  matchId: string;
  inviteCode: string;
  version: number;
  streamSequence: number;
  seed: number;
  config: OnlineMatchConfig;
  blackPlayerId: string | null;
  whitePlayerId: string | null;
  status: MatchStatus;
  state: unknown;
  endReason: MatchEndReason | null;
}

function safeInteger(value: number | string, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Corrupt PostgreSQL ${field}: expected a safe integer.`);
  }
  return parsed;
}

function onlineConfig(value: unknown): OnlineMatchConfig {
  const validated = validateClientMessage({
    protocol: PROTOCOL_NAME,
    protocolVersion: PROTOCOL_VERSION,
    messageType: "command",
    commandId: "command_config_probe",
    sentAt: "2026-01-01T00:00:00.000Z",
    actor: {
      playerId: "player_config_probe",
      sessionId: "session_config_probe",
    },
    matchId: null,
    expectedMatchVersion: null,
    command: { type: "CreateMatch", config: value },
  });
  if (!validated.ok || validated.value.command.type !== "CreateMatch") {
    throw new Error("Corrupt PostgreSQL match config.");
  }
  return validated.value.command.config;
}

function matchStatus(value: string): MatchStatus {
  if (
    value !== "awaitingOpponent" &&
    value !== "active" &&
    value !== "ended"
  ) {
    throw new Error(`Corrupt PostgreSQL match status: ${value}.`);
  }
  return value;
}

function endReason(value: string | null): MatchEndReason | null {
  if (
    value !== null &&
    value !== "king_capture" &&
    value !== "territory" &&
    value !== "timeout" &&
    value !== "resignation" &&
    value !== "abandonment"
  ) {
    throw new Error(`Corrupt PostgreSQL match end reason: ${value}.`);
  }
  return value;
}

function eventEnvelopes(value: unknown): ServerEventEnvelope[] {
  if (!Array.isArray(value)) {
    throw new Error("Corrupt PostgreSQL command receipt envelopes.");
  }
  return value.map((entry) => {
    const validated = validateServerMessage(entry);
    if (!validated.ok) {
      throw new Error(
        `Corrupt PostgreSQL command receipt envelope at ${validated.error.path}.`,
      );
    }
    return validated.value;
  });
}

export function encodeMatchAggregate(
  aggregate: MatchAggregate,
): EncodedMatchAggregate {
  return {
    matchId: aggregate.matchId,
    inviteCode: aggregate.inviteCode,
    version: aggregate.version,
    streamSequence: aggregate.streamSequence,
    seed: aggregate.seed,
    config: aggregate.config,
    blackPlayerId: aggregate.members.Black,
    whitePlayerId: aggregate.members.White,
    status: aggregate.status,
    state: JSON.parse(serializeState(aggregate.state)) as unknown,
    endReason: aggregate.endReason,
  };
}

export function decodeMatchAggregate(row: PostgresMatchRow): MatchAggregate {
  const state = deserializeState(JSON.stringify(row.state));
  if (!state) {
    throw new Error(`Corrupt PostgreSQL match state for ${row.match_id}.`);
  }
  return {
    matchId: row.match_id,
    inviteCode: row.invite_code,
    version: safeInteger(row.version, "match version"),
    streamSequence: safeInteger(row.stream_sequence, "stream sequence"),
    seed: safeInteger(row.seed, "seed"),
    config: onlineConfig(row.config),
    members: {
      Black: row.black_player_id,
      White: row.white_player_id,
    },
    status: matchStatus(row.status),
    state,
    endReason: endReason(row.end_reason),
  };
}

export function encodeReceipt(receipt: StoredCommandReceipt): {
  commandId: string;
  playerId: string;
  matchId: string | null;
  payloadHash: string;
  envelopes: ServerEventEnvelope[];
} {
  return {
    commandId: receipt.commandId,
    playerId: receipt.playerId,
    matchId: receipt.matchId,
    payloadHash: receipt.payloadHash,
    envelopes: receipt.envelopes,
  };
}

export function decodeReceipt(
  row: PostgresReceiptRow,
): StoredCommandReceipt {
  return {
    commandId: row.command_id,
    playerId: row.player_id,
    matchId: row.match_id,
    payloadHash: row.payload_hash,
    envelopes: eventEnvelopes(row.envelopes),
  };
}
