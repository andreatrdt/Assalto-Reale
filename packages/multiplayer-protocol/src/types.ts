export const PROTOCOL_NAME = "assalto-reale" as const;
export const PROTOCOL_VERSION = 2 as const;

export type ProtocolName = typeof PROTOCOL_NAME;
export type ProtocolVersion = typeof PROTOCOL_VERSION;
export type PlayerSide = "Black" | "White";
export type PawnType = "AttackPawn" | "DefensePawn" | "ConquestPawn";
export type PlacementMode = "Manual" | "QuickBalanced";
export type Coordinate = [number, number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface CanonicalMatchSnapshot extends JsonObject {
  schema: 1;
}

export interface ActorIdentity {
  playerId: string;
  sessionId: string;
}

export type PreferredSide = PlayerSide | "Random";

export type TimeControl =
  | { kind: "untimed" }
  | {
      kind: "clock";
      initialSeconds: number;
      disconnectGraceSeconds: number;
    };

export interface OnlineMatchConfig {
  visibility: "invite";
  placementMode: PlacementMode;
  transformEnabled: boolean;
  preferredSide: PreferredSide;
  timeControl: TimeControl;
}

export const MATCH_REPLAY_SCHEMA_VERSION = 2 as const;
export const MATCH_RULES_VERSION = 2 as const;
export type DeflectionRouteId = "primary" | "clockwise" | "counterClockwise";

export type HistoricalGameCommand = Extract<
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
      | "PassTurn"
      | "Resign";
  }
>;

export type MatchHistoryEventType =
  | "place_piece"
  | "submit_action"
  | "choose_defender"
  | "cancel_defended_king"
  | "activate_transform"
  | "choose_transform"
  | "decline_transform"
  | "pass_turn"
  | "resignation"
  | "timeout";

export interface MatchHistoryReplayEvent {
  sequenceNumber: number;
  eventType: MatchHistoryEventType;
  actorSide: PlayerSide | null;
  occurredAt: string;
  matchVersionBefore: number;
  matchVersionAfter: number;
  payload: {
    schemaVersion: number;
    command: HistoricalGameCommand;
  };
}

export type MatchHistoryPerspectiveResult = "win" | "loss" | "draw";

export interface MatchHistoryParticipant {
  side: PlayerSide;
  kind: "guest" | "registered";
  displayIdentity: string;
}

export interface MatchHistorySummary {
  matchId: string;
  completedAt: string;
  opponent: MatchHistoryParticipant;
  side: PlayerSide;
  result: MatchHistoryPerspectiveResult;
  victoryReason: MatchEndReason;
  durationSeconds: number;
  turnCount: number;
  predecessorMatchId: string | null;
  successorMatchId: string | null;
  replayAvailable: boolean;
}

export interface MatchHistoryPage {
  matches: MatchHistorySummary[];
  nextCursor: string | null;
}

export interface MatchHistoryPlayerStatistics {
  capturesMade: number;
  piecesLost: number;
  transformations: number;
  defendedKingSacrifices: number;
  territoryClaimsCreated: number;
}

export interface PlayerStatisticsSummary {
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  kingCaptureWins: number;
  territoryWins: number;
  timeoutWins: number;
  resignationWins: number;
  blackGames: number;
  blackWins: number;
  whiteGames: number;
  whiteWins: number;
  totalTurns: number;
  totalDurationSeconds: number;
  capturesMade: number;
  piecesLost: number;
  transformations: number;
  defendedKingSacrifices: number;
  territoryClaimsCreated: number;
  currentWinStreak: number;
  longestWinStreak: number;
  updatedAt: string | null;
  version: number;
}

export interface MatchHistoryDetails {
  matchId: string;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  players: Record<PlayerSide, MatchHistoryParticipant>;
  viewerSide: PlayerSide;
  result: MatchHistoryPerspectiveResult;
  winner: PlayerSide | null;
  victoryReason: MatchEndReason;
  durationSeconds: number;
  turnCount: number;
  predecessorMatchId: string | null;
  successorMatchId: string | null;
  finalMatchVersion: number;
  rulesVersion: number;
  protocolVersion: number;
  replaySchemaVersion: number;
  replayAvailable: boolean;
  integrityChecksum: string;
  seed: number;
  config: OnlineMatchConfig;
  finalSnapshot: CanonicalMatchSnapshot;
  statistics: Record<PlayerSide, MatchHistoryPlayerStatistics>;
  events: MatchHistoryReplayEvent[];
}

/**
 * Authoritative match lifecycle, conveyed on a canonical snapshot so a
 * reconnecting client restores membership/completion state without inferring it
 * from the match version.
 */
export type MatchLifecycleStatus = "awaitingOpponent" | "active" | "ended";

export type PostGamePresenceStatus = "present" | "grace" | "absent";
export type PostGamePresenceReason =
  "reconnected" | "reentered" | "disconnected" | "left" | "grace_expired";

/** Durable, side-addressed post-game state. Grace deadlines remain server-only. */
export interface PostGameSnapshot {
  presence: Record<PlayerSide, PostGamePresenceStatus>;
  rematchOfferedBy: PlayerSide | null;
}

export type ClientCommand =
  | { type: "CreateMatch"; config: OnlineMatchConfig }
  | { type: "JoinMatch"; inviteCode: string }
  | { type: "PlacePiece"; position: Coordinate }
  | {
      type: "SubmitAction";
      start: Coordinate;
      end: Coordinate;
      routeId?: DeflectionRouteId;
    }
  | { type: "ChooseDefender"; position: Coordinate }
  | { type: "CancelDefendedKing" }
  | { type: "ActivateTransform"; position: Coordinate }
  | { type: "ChooseTransform"; newType: PawnType }
  | { type: "DeclineTransform" }
  | { type: "PassTurn" }
  | { type: "Resign" }
  | { type: "OfferRematch" }
  | { type: "RespondToRematch"; accept: boolean }
  | { type: "LeavePostGame" }
  | { type: "RequestSync"; lastSeenMatchVersion: number | null };

export interface ClientCommandEnvelope<
  C extends ClientCommand = ClientCommand,
> {
  protocol: ProtocolName;
  protocolVersion: ProtocolVersion;
  messageType: "command";
  commandId: string;
  sentAt: string;
  actor: ActorIdentity;
  matchId: string | null;
  expectedMatchVersion: number | null;
  command: C;
}

export type PendingDecisionWire =
  | {
      kind: "defendedKing";
      owner: PlayerSide;
      defenders: Coordinate[];
      attackerOrigin: Coordinate;
      kingPosition: Coordinate;
      landingPosition: Coordinate;
      routes: Array<{
        id: DeflectionRouteId;
        path: Coordinate[];
        jumpedSquares: Coordinate[];
        turnSquares: Coordinate[];
        landingPosition: Coordinate;
      }>;
      pathDefender: Coordinate | null;
    }
  | {
      kind: "transform";
      owner: PlayerSide;
      position: Coordinate;
      currentType: PawnType;
      options: PawnType[];
    };

export type MatchEndReason =
  "king_capture" | "territory" | "timeout" | "resignation" | "abandonment";

export type CommandRejectionCode =
  | "invalid_message"
  | "unsupported_protocol_version"
  | "unauthenticated"
  | "unauthorized"
  | "match_not_found"
  | "invite_invalid"
  | "match_full"
  | "stale_match_version"
  | "duplicate_command"
  | "not_your_turn"
  | "illegal_command"
  | "decision_required"
  | "match_ended"
  | "post_game_unavailable"
  | "rate_limited"
  | "internal_error";

export type ServerEvent =
  | {
      type: "MatchCreated";
      inviteCode: string;
      assignedSide: PlayerSide;
      snapshot: CanonicalMatchSnapshot;
    }
  | {
      type: "PlayerJoined";
      playerId: string;
      assignedSide: PlayerSide;
      snapshot: CanonicalMatchSnapshot;
    }
  | {
      type: "MatchUpdated";
      snapshot: CanonicalMatchSnapshot;
      domainEvents: JsonObject[];
    }
  | {
      type: "DecisionRequired";
      decision: PendingDecisionWire;
    }
  | {
      type: "TurnChanged";
      currentPlayer: PlayerSide;
    }
  | {
      type: "MatchEnded";
      winner: PlayerSide;
      loser: PlayerSide | null;
      reason: MatchEndReason;
      snapshot: CanonicalMatchSnapshot;
      postGame?: PostGameSnapshot;
    }
  | {
      type: "CommandRejected";
      commandId: string;
      code: CommandRejectionCode;
      message: string;
      currentMatchVersion: number | null;
      snapshot?: CanonicalMatchSnapshot;
      postGame?: PostGameSnapshot;
    }
  | {
      type: "RematchOffered";
      offeredByPlayerId: string;
    }
  | {
      type: "RematchDeclined";
      declinedByPlayerId: string;
    }
  | {
      type: "RematchCreated";
      newMatchId: string;
      inviteCode: string;
      assignedSide: PlayerSide;
      snapshot: CanonicalMatchSnapshot;
    }
  | {
      type: "PostGamePresenceChanged";
      side: PlayerSide;
      presence: PostGamePresenceStatus;
      reason: PostGamePresenceReason;
      offerCancelled: boolean;
      postGame: PostGameSnapshot;
    }
  | {
      type: "MatchSnapshot";
      snapshot: CanonicalMatchSnapshot;
      status: MatchLifecycleStatus;
      /** Optional only for compatibility with already-persisted v1 receipts. */
      postGame?: PostGameSnapshot;
    };

export interface ServerEventEnvelope<E extends ServerEvent = ServerEvent> {
  protocol: ProtocolName;
  protocolVersion: ProtocolVersion;
  messageType: "event";
  eventId: string;
  emittedAt: string;
  matchId: string | null;
  matchVersion: number | null;
  streamSequence: number | null;
  causationCommandId: string | null;
  recipient: "all" | { playerId: string };
  event: E;
}

export interface ProtocolValidationError {
  code:
    | "invalid_json"
    | "invalid_envelope"
    | "unsupported_protocol_version"
    | "invalid_command"
    | "invalid_event";
  path: string;
  message: string;
}

export type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; error: ProtocolValidationError };
