import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  type ActorIdentity,
  type CanonicalMatchSnapshot,
  type ClientCommand,
  type ClientCommandEnvelope,
  type CommandRejectionCode,
  type Coordinate,
  type JsonObject,
  type OnlineMatchConfig,
  type PawnType,
  type PendingDecisionWire,
  type PlayerSide,
  type ProtocolValidationError,
  type ServerEvent,
  type ServerEventEnvelope,
  type ValidationResult,
} from "./types.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const INVITE_PATTERN = /^[A-Z0-9]{6,16}$/;
const PAWN_TYPES = new Set<PawnType>([
  "AttackPawn",
  "DefensePawn",
  "ConquestPawn",
]);
const PLAYER_SIDES = new Set<PlayerSide>(["Black", "White"]);
const REJECTION_CODES = new Set<CommandRejectionCode>([
  "invalid_message",
  "unsupported_protocol_version",
  "unauthenticated",
  "unauthorized",
  "match_not_found",
  "invite_invalid",
  "match_full",
  "stale_match_version",
  "duplicate_command",
  "not_your_turn",
  "illegal_command",
  "decision_required",
  "match_ended",
  "rate_limited",
  "internal_error",
]);

function error(
  code: ProtocolValidationError["code"],
  path: string,
  message: string,
): ValidationResult<never> {
  return { ok: false, error: { code, path, message } };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.includes("T") &&
    Number.isFinite(Date.parse(value))
  );
}

function isPlayerSide(value: unknown): value is PlayerSide {
  return typeof value === "string" && PLAYER_SIDES.has(value as PlayerSide);
}

function isPawnType(value: unknown): value is PawnType {
  return typeof value === "string" && PAWN_TYPES.has(value as PawnType);
}

function isCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isInteger(value[0]) &&
    Number.isInteger(value[1]) &&
    value[0] >= 0 &&
    value[0] < 64 &&
    value[1] >= 0 &&
    value[1] < 64
  );
}

function isActor(value: unknown): value is ActorIdentity {
  return (
    isRecord(value) &&
    Object.keys(value).every(
      (key) => key === "playerId" || key === "sessionId",
    ) &&
    isId(value.playerId) &&
    isId(value.sessionId)
  );
}

function isSnapshot(value: unknown): value is CanonicalMatchSnapshot {
  return isRecord(value) && value.schema === 1;
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function isOnlineMatchConfig(value: unknown): value is OnlineMatchConfig {
  if (!isRecord(value)) return false;
  if (
    value.visibility !== "invite" ||
    (value.placementMode !== "Manual" &&
      value.placementMode !== "QuickBalanced") ||
    typeof value.transformEnabled !== "boolean" ||
    !["Black", "White", "Random"].includes(String(value.preferredSide)) ||
    !isRecord(value.timeControl)
  ) {
    return false;
  }
  if (value.timeControl.kind === "untimed") return true;
  return (
    value.timeControl.kind === "clock" &&
    isNonNegativeInteger(value.timeControl.initialSeconds) &&
    value.timeControl.initialSeconds > 0 &&
    isNonNegativeInteger(value.timeControl.disconnectGraceSeconds)
  );
}

function validateClientCommand(
  value: unknown,
): ValidationResult<ClientCommand> {
  if (!isRecord(value) || typeof value.type !== "string") {
    return error(
      "invalid_command",
      "command",
      "Command must be an object with a type.",
    );
  }

  switch (value.type) {
    case "CreateMatch":
      return isOnlineMatchConfig(value.config)
        ? { ok: true, value: value as ClientCommand }
        : error(
            "invalid_command",
            "command.config",
            "CreateMatch config is invalid.",
          );
    case "JoinMatch":
      return typeof value.inviteCode === "string" &&
        INVITE_PATTERN.test(value.inviteCode)
        ? { ok: true, value: value as ClientCommand }
        : error(
            "invalid_command",
            "command.inviteCode",
            "Invite code must contain 6-16 uppercase letters or digits.",
          );
    case "PlacePiece":
    case "ChooseDefender":
      return isCoordinate(value.position)
        ? { ok: true, value: value as ClientCommand }
        : error(
            "invalid_command",
            "command.position",
            "Position must be a valid board coordinate.",
          );
    case "SubmitAction":
      return isCoordinate(value.start) && isCoordinate(value.end)
        ? { ok: true, value: value as ClientCommand }
        : error(
            "invalid_command",
            "command",
            "SubmitAction requires valid start and end coordinates.",
          );
    case "ChooseTransform":
      return isPawnType(value.newType)
        ? { ok: true, value: value as ClientCommand }
        : error(
            "invalid_command",
            "command.newType",
            "Transform target must be a pawn type.",
          );
    case "RespondToRematch":
      return typeof value.accept === "boolean"
        ? { ok: true, value: value as ClientCommand }
        : error(
            "invalid_command",
            "command.accept",
            "Rematch response must be boolean.",
          );
    case "RequestSync":
      return value.lastSeenMatchVersion === null ||
        isNonNegativeInteger(value.lastSeenMatchVersion)
        ? { ok: true, value: value as ClientCommand }
        : error(
            "invalid_command",
            "command.lastSeenMatchVersion",
            "Last seen version must be null or non-negative.",
          );
    case "CancelDefendedKing":
    case "PassTurn":
    case "Resign":
    case "OfferRematch":
      return { ok: true, value: value as ClientCommand };
    default:
      return error(
        "invalid_command",
        "command.type",
        `Unknown command type: ${value.type}`,
      );
  }
}

function validateCommandRouting(
  command: ClientCommand,
  matchId: string | null,
  expectedMatchVersion: number | null,
): ValidationResult<true> {
  if (command.type === "CreateMatch") {
    return matchId === null && expectedMatchVersion === null
      ? { ok: true, value: true }
      : error(
          "invalid_envelope",
          "matchId",
          "CreateMatch must not target an existing match or version.",
        );
  }
  if (command.type === "JoinMatch") {
    // A JoinMatch is resolved by its invite code. The joining device only knows
    // the code, not the matchId, so matchId is optional: the authoritative core
    // loads by matchId when one is supplied and otherwise resolves the invite
    // (see authoritative-server CommandHandler). It never carries an expected
    // version — membership is decided by the server, not by an optimistic check.
    return expectedMatchVersion === null
      ? { ok: true, value: true }
      : error(
          "invalid_envelope",
          "expectedMatchVersion",
          "JoinMatch must not carry an expected match version.",
        );
  }
  if (command.type === "RequestSync") {
    return matchId !== null && expectedMatchVersion === null
      ? { ok: true, value: true }
      : error(
          "invalid_envelope",
          "expectedMatchVersion",
          "RequestSync requires a matchId and no expected version.",
        );
  }
  return matchId !== null && expectedMatchVersion !== null
    ? { ok: true, value: true }
    : error(
        "invalid_envelope",
        "expectedMatchVersion",
        "State-changing match commands require matchId and expectedMatchVersion.",
      );
}

export function validateClientMessage(
  value: unknown,
): ValidationResult<ClientCommandEnvelope> {
  if (!isRecord(value))
    return error("invalid_envelope", "$", "Client message must be an object.");
  if (value.protocol !== PROTOCOL_NAME)
    return error("invalid_envelope", "protocol", "Unknown protocol name.");
  if (value.protocolVersion !== PROTOCOL_VERSION) {
    return error(
      "unsupported_protocol_version",
      "protocolVersion",
      `Only protocol version ${PROTOCOL_VERSION} is supported.`,
    );
  }
  if (value.messageType !== "command")
    return error(
      "invalid_envelope",
      "messageType",
      "Client messageType must be command.",
    );
  if (!isId(value.commandId))
    return error(
      "invalid_envelope",
      "commandId",
      "commandId has an invalid format.",
    );
  if (!isTimestamp(value.sentAt))
    return error(
      "invalid_envelope",
      "sentAt",
      "sentAt must be an ISO timestamp.",
    );
  if (!isActor(value.actor))
    return error("invalid_envelope", "actor", "Actor identity is invalid.");
  if (value.matchId !== null && !isId(value.matchId))
    return error("invalid_envelope", "matchId", "matchId is invalid.");
  if (
    value.expectedMatchVersion !== null &&
    !isNonNegativeInteger(value.expectedMatchVersion)
  ) {
    return error(
      "invalid_envelope",
      "expectedMatchVersion",
      "Expected match version must be null or non-negative.",
    );
  }

  const command = validateClientCommand(value.command);
  if (!command.ok) return command;
  const routing = validateCommandRouting(
    command.value,
    value.matchId as string | null,
    value.expectedMatchVersion as number | null,
  );
  if (!routing.ok) return routing;
  return { ok: true, value: value as unknown as ClientCommandEnvelope };
}

function isPendingDecision(value: unknown): value is PendingDecisionWire {
  if (!isRecord(value) || !isPlayerSide(value.owner)) return false;
  if (value.kind === "defendedKing") {
    return (
      Array.isArray(value.defenders) &&
      value.defenders.length > 0 &&
      value.defenders.every(isCoordinate) &&
      isCoordinate(value.attackerOrigin) &&
      isCoordinate(value.kingPosition) &&
      isCoordinate(value.landingPosition)
    );
  }
  return (
    value.kind === "transform" &&
    isCoordinate(value.position) &&
    isPawnType(value.currentType) &&
    Array.isArray(value.options) &&
    value.options.length > 0 &&
    value.options.every(isPawnType)
  );
}

function validateServerEvent(value: unknown): ValidationResult<ServerEvent> {
  if (!isRecord(value) || typeof value.type !== "string") {
    return error(
      "invalid_event",
      "event",
      "Server event must be an object with a type.",
    );
  }
  switch (value.type) {
    case "MatchCreated":
      return typeof value.inviteCode === "string" &&
        INVITE_PATTERN.test(value.inviteCode) &&
        isPlayerSide(value.assignedSide) &&
        isSnapshot(value.snapshot)
        ? { ok: true, value: value as ServerEvent }
        : error("invalid_event", "event", "MatchCreated payload is invalid.");
    case "PlayerJoined":
      return isId(value.playerId) &&
        isPlayerSide(value.assignedSide) &&
        isSnapshot(value.snapshot)
        ? { ok: true, value: value as ServerEvent }
        : error("invalid_event", "event", "PlayerJoined payload is invalid.");
    case "MatchUpdated":
      return isSnapshot(value.snapshot) &&
        Array.isArray(value.domainEvents) &&
        value.domainEvents.every(isJsonObject)
        ? { ok: true, value: value as ServerEvent }
        : error("invalid_event", "event", "MatchUpdated payload is invalid.");
    case "DecisionRequired":
      return isPendingDecision(value.decision)
        ? { ok: true, value: value as ServerEvent }
        : error(
            "invalid_event",
            "event.decision",
            "Decision payload is invalid.",
          );
    case "TurnChanged":
      return isPlayerSide(value.currentPlayer)
        ? { ok: true, value: value as ServerEvent }
        : error(
            "invalid_event",
            "event.currentPlayer",
            "TurnChanged player is invalid.",
          );
    case "MatchEnded":
      return isPlayerSide(value.winner) &&
        (value.loser === null || isPlayerSide(value.loser)) &&
        [
          "king_capture",
          "territory",
          "timeout",
          "resignation",
          "abandonment",
        ].includes(String(value.reason)) &&
        isSnapshot(value.snapshot)
        ? { ok: true, value: value as ServerEvent }
        : error("invalid_event", "event", "MatchEnded payload is invalid.");
    case "CommandRejected":
      return isId(value.commandId) &&
        typeof value.code === "string" &&
        REJECTION_CODES.has(value.code as CommandRejectionCode) &&
        typeof value.message === "string" &&
        value.message.length > 0 &&
        (value.currentMatchVersion === null ||
          isNonNegativeInteger(value.currentMatchVersion)) &&
        (value.snapshot === undefined || isSnapshot(value.snapshot))
        ? { ok: true, value: value as ServerEvent }
        : error(
            "invalid_event",
            "event",
            "CommandRejected payload is invalid.",
          );
    case "RematchOffered":
      return isId(value.offeredByPlayerId)
        ? { ok: true, value: value as ServerEvent }
        : error(
            "invalid_event",
            "event.offeredByPlayerId",
            "Rematch offer player is invalid.",
          );
    case "RematchCreated":
      return isId(value.newMatchId) &&
        typeof value.inviteCode === "string" &&
        INVITE_PATTERN.test(value.inviteCode)
        ? { ok: true, value: value as ServerEvent }
        : error("invalid_event", "event", "RematchCreated payload is invalid.");
    case "MatchSnapshot":
      return isSnapshot(value.snapshot)
        ? { ok: true, value: value as ServerEvent }
        : error(
            "invalid_event",
            "event.snapshot",
            "Snapshot payload is invalid.",
          );
    default:
      return error(
        "invalid_event",
        "event.type",
        `Unknown event type: ${value.type}`,
      );
  }
}

export function validateServerMessage(
  value: unknown,
): ValidationResult<ServerEventEnvelope> {
  if (!isRecord(value))
    return error("invalid_envelope", "$", "Server message must be an object.");
  if (value.protocol !== PROTOCOL_NAME)
    return error("invalid_envelope", "protocol", "Unknown protocol name.");
  if (value.protocolVersion !== PROTOCOL_VERSION) {
    return error(
      "unsupported_protocol_version",
      "protocolVersion",
      `Only protocol version ${PROTOCOL_VERSION} is supported.`,
    );
  }
  if (value.messageType !== "event")
    return error(
      "invalid_envelope",
      "messageType",
      "Server messageType must be event.",
    );
  if (!isId(value.eventId))
    return error(
      "invalid_envelope",
      "eventId",
      "eventId has an invalid format.",
    );
  if (!isTimestamp(value.emittedAt))
    return error(
      "invalid_envelope",
      "emittedAt",
      "emittedAt must be an ISO timestamp.",
    );
  if (value.matchId !== null && !isId(value.matchId))
    return error("invalid_envelope", "matchId", "matchId is invalid.");
  if (
    value.matchVersion !== null &&
    !isNonNegativeInteger(value.matchVersion)
  ) {
    return error(
      "invalid_envelope",
      "matchVersion",
      "matchVersion must be null or non-negative.",
    );
  }
  if (
    value.streamSequence !== null &&
    !isNonNegativeInteger(value.streamSequence)
  ) {
    return error(
      "invalid_envelope",
      "streamSequence",
      "streamSequence must be null or non-negative.",
    );
  }
  if (value.causationCommandId !== null && !isId(value.causationCommandId)) {
    return error(
      "invalid_envelope",
      "causationCommandId",
      "causationCommandId is invalid.",
    );
  }
  if (
    value.recipient !== "all" &&
    (!isRecord(value.recipient) || !isId(value.recipient.playerId))
  ) {
    return error("invalid_envelope", "recipient", "recipient is invalid.");
  }
  const event = validateServerEvent(value.event);
  if (!event.ok) return event;

  if (event.value.type === "CommandRejected") {
    // Rejections for CreateMatch may not have a match yet and do not enter the
    // ordered aggregate event stream.
    if (value.streamSequence !== null) {
      return error(
        "invalid_envelope",
        "streamSequence",
        "CommandRejected must not consume aggregate stream sequence.",
      );
    }
    return { ok: true, value: value as unknown as ServerEventEnvelope };
  }
  if (
    value.matchId === null ||
    value.matchVersion === null ||
    value.streamSequence === null
  ) {
    return error(
      "invalid_envelope",
      "matchId",
      "Accepted match events require matchId, matchVersion and streamSequence.",
    );
  }
  return { ok: true, value: value as unknown as ServerEventEnvelope };
}
