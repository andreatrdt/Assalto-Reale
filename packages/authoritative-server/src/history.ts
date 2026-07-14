import { createHash } from "node:crypto";
import {
  REPLAY_SCHEMA_VERSION,
  replayHistoricalMatch,
  serializeState,
  type MatchState,
} from "@assalto-reale/game-core";
import {
  MATCH_REPLAY_SCHEMA_VERSION,
  PROTOCOL_VERSION,
  type HistoricalGameCommand,
  type MatchEndReason,
  type MatchHistoryDetails,
  type MatchHistoryEventType,
  type MatchHistoryPage,
  type MatchHistoryReplayEvent,
  type OnlineMatchConfig,
  type PlayerSide,
  type PlayerStatisticsSummary,
} from "@assalto-reale/multiplayer-protocol";
import type { MatchAggregate } from "./domain/matchAggregate.js";
import { snapshotOf } from "./protocol/translate.js";

export interface PerSideHistoryFacts {
  capturesMade: number;
  piecesLost: number;
  transformations: number;
  defendedKingSacrifices: number;
  territoryClaimsCreated: number;
}

export type HistoryFacts = Record<PlayerSide, PerSideHistoryFacts>;

export interface StoredHistoryEvent extends MatchHistoryReplayEvent {
  actorPlayerId: string | null;
  payload: MatchHistoryReplayEvent["payload"] & { facts: HistoryFacts };
}

export interface HistoryCompletionContext {
  createdAt: string;
  startedAt: string;
  completedAt: string;
  blackUserId: string | null;
  whiteUserId: string | null;
}

export interface ImmutableMatchHistoryRecord {
  matchId: string;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  blackPlayerId: string;
  whitePlayerId: string;
  blackUserId: string | null;
  whiteUserId: string | null;
  winnerSide: PlayerSide | null;
  result: "Black" | "White" | "draw";
  victoryReason: MatchEndReason;
  totalTurns: number;
  totalEvents: number;
  durationSeconds: number;
  timeControl: OnlineMatchConfig["timeControl"];
  rated: false;
  predecessorMatchId: string | null;
  finalMatchVersion: number;
  rulesVersion: number;
  protocolVersion: number;
  replaySchemaVersion: number;
  replayAvailable: boolean;
  seed: number;
  config: OnlineMatchConfig;
  finalSnapshot: ReturnType<typeof snapshotOf>;
  createdFromAuthoritativeMatchVersion: number;
  blackFacts: PerSideHistoryFacts;
  whiteFacts: PerSideHistoryFacts;
  integrityChecksum: string;
}

export interface MatchHistoryFilters {
  cursor?: string;
  limit?: number;
  result?: "win" | "loss" | "draw";
  side?: PlayerSide;
  victoryReason?: MatchEndReason;
  completedFrom?: string;
  completedTo?: string;
}

export interface MatchHistoryRepository {
  listForUser(
    userId: string,
    filters: MatchHistoryFilters,
  ): Promise<MatchHistoryPage>;
  getForUser(
    userId: string,
    matchId: string,
  ): Promise<MatchHistoryDetails | null>;
  statisticsForUser(userId: string): Promise<PlayerStatisticsSummary>;
}

export interface OperationalCleanupResult {
  commandReceiptsDeleted: number;
  websocketTicketsDeleted: number;
}

export interface HistoryStorageMetrics {
  completedMatches: number;
  replayEvents: number;
  commandReceipts: number;
  estimatedHistoryBytes: number;
}

export interface OperationalMaintenanceRepository {
  cleanupTransientRecords(input: {
    before: Date;
    limit: number;
  }): Promise<OperationalCleanupResult>;
  historyStorageMetrics(): Promise<HistoryStorageMetrics>;
}

function emptyFacts(): PerSideHistoryFacts {
  return {
    capturesMade: 0,
    piecesLost: 0,
    transformations: 0,
    defendedKingSacrifices: 0,
    territoryClaimsCreated: 0,
  };
}

function facts(): HistoryFacts {
  return { Black: emptyFacts(), White: emptyFacts() };
}

function sumCaptured(state: MatchState, side: PlayerSide): number {
  return Object.values(state.board.capturedPieces[side]).reduce(
    (sum, count) => sum + count,
    0,
  );
}

function replayEventType(
  command: HistoricalGameCommand,
): MatchHistoryEventType {
  switch (command.type) {
    case "PlacePiece":
      return "place_piece";
    case "SubmitAction":
      return "submit_action";
    case "ChooseDefender":
      return "choose_defender";
    case "CancelDefendedKing":
      return "cancel_defended_king";
    case "ActivateTransform":
      return "activate_transform";
    case "ChooseTransform":
      return "choose_transform";
    case "DeclineTransform":
      return "decline_transform";
    case "PassTurn":
      return "pass_turn";
    case "Resign":
      return "resignation";
  }
}

export function createStoredHistoryEvent(input: {
  previous: MatchAggregate;
  next: MatchAggregate;
  actorPlayerId: string;
  actorSide: PlayerSide;
  command: HistoricalGameCommand;
  occurredAt: Date;
}): StoredHistoryEvent {
  const delta = facts();
  for (const side of ["Black", "White"] as const) {
    delta[side].piecesLost = Math.max(
      0,
      sumCaptured(input.next.state, side) -
        sumCaptured(input.previous.state, side),
    );
  }
  const captureSide: PlayerSide =
    input.command.type === "ChooseDefender" &&
    input.previous.state.pendingDefendedKing?.action.player
      ? input.previous.state.pendingDefendedKing.action.player
      : input.actorSide;
  delta[captureSide].capturesMade =
    delta.Black.piecesLost + delta.White.piecesLost;
  if (input.command.type === "ChooseTransform")
    delta[input.actorSide].transformations = 1;
  if (
    input.command.type === "ChooseDefender" &&
    input.previous.state.pendingDefendedKing
  ) {
    delta[input.actorSide].defendedKingSacrifices = 1;
  }
  const beforeClaim = input.previous.state.board.territoryClaim;
  const afterClaim = input.next.state.board.territoryClaim;
  if (
    afterClaim &&
    (!beforeClaim ||
      beforeClaim.claimant !== afterClaim.claimant ||
      beforeClaim.createdTurn !== afterClaim.createdTurn)
  ) {
    delta[afterClaim.claimant].territoryClaimsCreated = 1;
  }
  return {
    sequenceNumber: input.next.historyEventSequence,
    eventType: replayEventType(input.command),
    actorPlayerId: input.actorPlayerId,
    actorSide: input.actorSide,
    occurredAt: input.occurredAt.toISOString(),
    matchVersionBefore: input.previous.version,
    matchVersionAfter: input.next.version,
    payload: {
      schemaVersion:
        input.previous.state.rulesVersion === 1
          ? 1
          : MATCH_REPLAY_SCHEMA_VERSION,
      command: input.command,
      facts: delta,
    },
  };
}

function addFacts(
  events: StoredHistoryEvent[],
  side: PlayerSide,
): PerSideHistoryFacts {
  return events.reduce<PerSideHistoryFacts>((total, event) => {
    const value = event.payload.facts[side];
    total.capturesMade += value.capturesMade;
    total.piecesLost += value.piecesLost;
    total.transformations += value.transformations;
    total.defendedKingSacrifices += value.defendedKingSacrifices;
    total.territoryClaimsCreated += value.territoryClaimsCreated;
    return total;
  }, emptyFacts());
}

function winnerOf(
  aggregate: MatchAggregate,
  events: StoredHistoryEvent[],
): PlayerSide | null {
  if (aggregate.state.victory?.winner) return aggregate.state.victory.winner;
  const last = events.at(-1);
  if (
    aggregate.endReason === "resignation" &&
    last?.eventType === "resignation" &&
    last.actorSide
  ) {
    return last.actorSide === "Black" ? "White" : "Black";
  }
  return null;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function canonicalState(state: MatchState): string {
  return stable(JSON.parse(serializeState(state)) as unknown);
}

function replayIsComplete(
  aggregate: MatchAggregate,
  events: StoredHistoryEvent[],
): boolean {
  if (aggregate.historyCaptureStartedAtVersion !== 1) return false;
  if (events.length !== aggregate.historyEventSequence) {
    throw new Error(
      `Captured replay event count mismatch for ${aggregate.matchId}: expected ${aggregate.historyEventSequence}, received ${events.length}.`,
    );
  }
  const sequenceGap = events.findIndex(
    (event, index) => event.sequenceNumber !== index + 1,
  );
  if (sequenceGap >= 0) {
    throw new Error(
      `Captured replay sequence mismatch for ${aggregate.matchId} at event ${sequenceGap + 1}.`,
    );
  }
  const replay = replayHistoricalMatch({
    rulesVersion: aggregate.state.rulesVersion,
    replaySchemaVersion:
      aggregate.state.rulesVersion === 1 ? 1 : REPLAY_SCHEMA_VERSION,
    seed: aggregate.seed,
    placementMode: aggregate.config.placementMode,
    transformEnabled: aggregate.config.transformEnabled,
    events,
  });
  if (!replay.ok) {
    throw new Error(
      `Captured replay for ${aggregate.matchId} is invalid: ${replay.message}`,
    );
  }
  const finalFrame = replay.frames.at(-1);
  if (
    !finalFrame ||
    canonicalState(finalFrame.state) !== canonicalState(aggregate.state)
  ) {
    throw new Error(
      `Captured replay final state mismatch for ${aggregate.matchId}.`,
    );
  }
  return true;
}

export function buildImmutableMatchHistory(
  aggregate: MatchAggregate,
  events: StoredHistoryEvent[],
  context: HistoryCompletionContext,
): ImmutableMatchHistoryRecord {
  if (aggregate.status !== "ended" || !aggregate.endReason)
    throw new Error("Only a completed match can be finalized.");
  const blackPlayerId = aggregate.members.Black;
  const whitePlayerId = aggregate.members.White;
  if (!blackPlayerId || !whitePlayerId)
    throw new Error(
      "A historical match requires both authoritative participants.",
    );
  const winnerSide = winnerOf(aggregate, events);
  const durationSeconds = Math.max(
    0,
    Math.floor(
      (Date.parse(context.completedAt) - Date.parse(context.startedAt)) / 1_000,
    ),
  );
  const withoutChecksum = {
    matchId: aggregate.matchId,
    createdAt: context.createdAt,
    startedAt: context.startedAt,
    completedAt: context.completedAt,
    blackPlayerId,
    whitePlayerId,
    blackUserId: context.blackUserId,
    whiteUserId: context.whiteUserId,
    winnerSide,
    result: winnerSide ?? ("draw" as const),
    victoryReason: aggregate.endReason,
    totalTurns: aggregate.state.turnCounter,
    totalEvents: events.length,
    durationSeconds,
    timeControl: aggregate.config.timeControl,
    rated: false as const,
    predecessorMatchId: aggregate.predecessorMatchId,
    finalMatchVersion: aggregate.version,
    rulesVersion: aggregate.state.rulesVersion,
    protocolVersion: PROTOCOL_VERSION,
    replaySchemaVersion:
      aggregate.state.rulesVersion === 1 ? 1 : REPLAY_SCHEMA_VERSION,
    replayAvailable: replayIsComplete(aggregate, events),
    seed: aggregate.seed,
    config: aggregate.config,
    finalSnapshot: snapshotOf(aggregate.state),
    createdFromAuthoritativeMatchVersion: aggregate.version,
    blackFacts: addFacts(events, "Black"),
    whiteFacts: addFacts(events, "White"),
  };
  return {
    ...withoutChecksum,
    integrityChecksum: createHash("sha256")
      .update(stable(withoutChecksum))
      .digest("hex"),
  };
}

export function emptyPlayerStatistics(): PlayerStatisticsSummary {
  return {
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    kingCaptureWins: 0,
    territoryWins: 0,
    timeoutWins: 0,
    resignationWins: 0,
    blackGames: 0,
    blackWins: 0,
    whiteGames: 0,
    whiteWins: 0,
    totalTurns: 0,
    totalDurationSeconds: 0,
    capturesMade: 0,
    piecesLost: 0,
    transformations: 0,
    defendedKingSacrifices: 0,
    territoryClaimsCreated: 0,
    currentWinStreak: 0,
    longestWinStreak: 0,
    updatedAt: null,
    version: 0,
  };
}

export function applyMatchToPlayerStatistics(
  current: PlayerStatisticsSummary,
  record: Pick<
    ImmutableMatchHistoryRecord,
    | "winnerSide"
    | "victoryReason"
    | "totalTurns"
    | "durationSeconds"
    | "blackFacts"
    | "whiteFacts"
    | "completedAt"
  >,
  side: PlayerSide,
): PlayerStatisticsSummary {
  const won = record.winnerSide === side;
  const lost = record.winnerSide !== null && !won;
  const factsForSide = side === "Black" ? record.blackFacts : record.whiteFacts;
  const currentWinStreak = won ? current.currentWinStreak + 1 : 0;
  return {
    gamesPlayed: current.gamesPlayed + 1,
    wins: current.wins + (won ? 1 : 0),
    losses: current.losses + (lost ? 1 : 0),
    draws: current.draws + (record.winnerSide === null ? 1 : 0),
    kingCaptureWins:
      current.kingCaptureWins +
      (won && record.victoryReason === "king_capture" ? 1 : 0),
    territoryWins:
      current.territoryWins +
      (won && record.victoryReason === "territory" ? 1 : 0),
    timeoutWins:
      current.timeoutWins + (won && record.victoryReason === "timeout" ? 1 : 0),
    resignationWins:
      current.resignationWins +
      (won && record.victoryReason === "resignation" ? 1 : 0),
    blackGames: current.blackGames + (side === "Black" ? 1 : 0),
    blackWins: current.blackWins + (side === "Black" && won ? 1 : 0),
    whiteGames: current.whiteGames + (side === "White" ? 1 : 0),
    whiteWins: current.whiteWins + (side === "White" && won ? 1 : 0),
    totalTurns: current.totalTurns + record.totalTurns,
    totalDurationSeconds: current.totalDurationSeconds + record.durationSeconds,
    capturesMade: current.capturesMade + factsForSide.capturesMade,
    piecesLost: current.piecesLost + factsForSide.piecesLost,
    transformations: current.transformations + factsForSide.transformations,
    defendedKingSacrifices:
      current.defendedKingSacrifices + factsForSide.defendedKingSacrifices,
    territoryClaimsCreated:
      current.territoryClaimsCreated + factsForSide.territoryClaimsCreated,
    currentWinStreak,
    longestWinStreak: Math.max(current.longestWinStreak, currentWinStreak),
    updatedAt: record.completedAt,
    version: current.version + 1,
  };
}
