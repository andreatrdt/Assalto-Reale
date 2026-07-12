export const PROTOCOL_NAME = "assalto-reale" as const;
export const PROTOCOL_VERSION = 1 as const;

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

export type ClientCommand =
  | { type: "CreateMatch"; config: OnlineMatchConfig }
  | { type: "JoinMatch"; inviteCode: string }
  | { type: "PlacePiece"; position: Coordinate }
  | { type: "SubmitAction"; start: Coordinate; end: Coordinate }
  | { type: "ChooseDefender"; position: Coordinate }
  | { type: "CancelDefendedKing" }
  | { type: "ChooseTransform"; newType: PawnType }
  | { type: "PassTurn" }
  | { type: "Resign" }
  | { type: "OfferRematch" }
  | { type: "RespondToRematch"; accept: boolean }
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
    }
  | {
      type: "CommandRejected";
      commandId: string;
      code: CommandRejectionCode;
      message: string;
      currentMatchVersion: number | null;
      snapshot?: CanonicalMatchSnapshot;
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
      type: "MatchSnapshot";
      snapshot: CanonicalMatchSnapshot;
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
