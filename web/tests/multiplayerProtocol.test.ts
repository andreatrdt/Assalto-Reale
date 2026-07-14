import { describe, expect, it } from "vitest";
import type { GameCommand } from "../../packages/game-core/src/index.js";
import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  validateClientMessage,
  validateServerMessage,
  type CanonicalMatchSnapshot,
  type ClientCommand,
  type ClientCommandEnvelope,
  type ServerEventEnvelope,
} from "../../packages/multiplayer-protocol/src/index.js";

type ProtocolCoreCommand = Extract<
  ClientCommand,
  {
    type: "PlacePiece" | "SubmitAction" | "ChooseDefender" | "CancelDefendedKing" | "ChooseTransform" | "PassTurn";
  }
>;
type Assert<T extends true> = T;
// Protocol game commands are structurally assignable to game-core commands, so
// the authoritative server can forward a validated wire command straight into
// game-core without reshaping. The reverse does not hold by design: game-core's
// Vec2 is a `readonly` tuple whereas the wire Coordinate is mutable.
type _ProtocolCommandsAssignableToCore = Assert<ProtocolCoreCommand extends GameCommand ? true : false>;

const actor = {
  playerId: "player_01HZY8R7",
  sessionId: "session_01HZY8R7",
};

const snapshot: CanonicalMatchSnapshot = {
  schema: 1,
  phase: "playing",
  currentPlayer: "Black",
};

function createEnvelope(command: ClientCommand): ClientCommandEnvelope {
  const createsMatch = command.type === "CreateMatch";
  const readsMatch = command.type === "JoinMatch" || command.type === "RequestSync";
  return {
    protocol: PROTOCOL_NAME,
    protocolVersion: PROTOCOL_VERSION,
    messageType: "command",
    commandId: "command_01HZY8R7",
    sentAt: "2026-07-10T12:00:00.000Z",
    actor,
    matchId: createsMatch ? null : "match_01HZY8R7",
    expectedMatchVersion: createsMatch || readsMatch ? null : 4,
    command,
  };
}

function serverEnvelope(event: ServerEventEnvelope["event"]): ServerEventEnvelope {
  return {
    protocol: PROTOCOL_NAME,
    protocolVersion: PROTOCOL_VERSION,
    messageType: "event",
    eventId: "event_01HZY8R7",
    emittedAt: "2026-07-10T12:00:01.000Z",
    matchId: "match_01HZY8R7",
    matchVersion: 5,
    streamSequence: 12,
    causationCommandId: "command_01HZY8R7",
    recipient: "all",
    event,
  };
}

describe("multiplayer protocol", () => {
  it("round-trips a valid invite-only untimed CreateMatch command", () => {
    const message = createEnvelope({
      type: "CreateMatch",
      config: {
        visibility: "invite",
        placementMode: "Manual",
        transformEnabled: true,
        preferredSide: "Random",
        timeControl: { kind: "untimed" },
      },
    });

    const encoded = encodeClientMessage(message);
    expect(decodeClientMessage(encoded)).toEqual({ ok: true, value: message });
  });

  it("requires CreateMatch to have no match ID or expected version", () => {
    const message = {
      ...createEnvelope({
        type: "CreateMatch",
        config: {
          visibility: "invite",
          placementMode: "Manual",
          transformEnabled: false,
          preferredSide: "Black",
          timeControl: { kind: "untimed" },
        },
      }),
      matchId: "match_01HZY8R7",
      expectedMatchVersion: 0,
    };
    const result = validateClientMessage(message);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_envelope");
  });

  it("requires state-changing match commands to carry optimistic version data", () => {
    const message = {
      ...createEnvelope({ type: "PassTurn" }),
      expectedMatchVersion: null,
    };
    const result = validateClientMessage(message);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.path).toBe("expectedMatchVersion");
  });

  it("allows JoinMatch and RequestSync without an expected version", () => {
    expect(validateClientMessage(createEnvelope({ type: "JoinMatch", inviteCode: "AB12CD34" })).ok).toBe(true);
    expect(validateClientMessage(createEnvelope({ type: "RequestSync", lastSeenMatchVersion: 9 })).ok).toBe(true);
  });

  it("round-trips explicit post-game departure and presence state", () => {
    const departure = {
      ...createEnvelope({ type: "LeavePostGame" }),
      expectedMatchVersion: null,
    };
    expect(validateClientMessage(departure).ok).toBe(true);

    const presence = serverEnvelope({
      type: "PostGamePresenceChanged",
      side: "White",
      presence: "absent",
      reason: "left",
      offerCancelled: true,
      postGame: {
        presence: { Black: "present", White: "absent" },
        rematchOfferedBy: null,
      },
    });
    expect(decodeServerMessage(encodeServerMessage(presence))).toEqual({
      ok: true,
      value: presence,
    });
  });

  it("rejects malformed coordinates and unknown protocol versions", () => {
    const malformed = createEnvelope({ type: "SubmitAction", start: [5, 5], end: [5, 6] });
    (malformed.command as { end: unknown }).end = [-1, 6];
    expect(validateClientMessage(malformed).ok).toBe(false);

    const unsupported = { ...createEnvelope({ type: "PassTurn" }), protocolVersion: 2 };
    const result = validateClientMessage(unsupported);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unsupported_protocol_version");
  });

  it("keeps authentication credentials outside the actor payload", () => {
    const message = createEnvelope({ type: "PassTurn" });
    (message.actor as typeof actor & { token: string }).token = "secret";
    const result = validateClientMessage(message);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.path).toBe("actor");
  });

  it("round-trips canonical server updates", () => {
    const message = serverEnvelope({
      type: "MatchUpdated",
      snapshot,
      domainEvents: [{ kind: "move", player: "Black" }],
    });
    const encoded = encodeServerMessage(message);
    expect(decodeServerMessage(encoded)).toEqual({ ok: true, value: message });
  });

  it("represents pending Defended King and Transform decisions", () => {
    const defended = serverEnvelope({
      type: "DecisionRequired",
      decision: {
        kind: "defendedKing",
        owner: "White",
        defenders: [[4, 3]],
        attackerOrigin: [5, 1],
        kingPosition: [5, 3],
        landingPosition: [5, 5],
      },
    });
    expect(validateServerMessage(defended).ok).toBe(true);

    const transform = serverEnvelope({
      type: "DecisionRequired",
      decision: {
        kind: "transform",
        owner: "Black",
        position: [5, 6],
        currentType: "AttackPawn",
        options: ["DefensePawn", "ConquestPawn"],
      },
    });
    expect(validateServerMessage(transform).ok).toBe(true);
  });

  it("carries the authoritative lifecycle status on a MatchSnapshot", () => {
    const valid = serverEnvelope({ type: "MatchSnapshot", snapshot, status: "active" });
    for (const status of ["awaitingOpponent", "active", "ended"] as const) {
      expect(validateServerMessage(serverEnvelope({ type: "MatchSnapshot", snapshot, status })).ok).toBe(true);
    }
    // The status is required and validated (invalid wire payloads are unknown).
    expect(validateServerMessage({ ...valid, event: { type: "MatchSnapshot", snapshot } }).ok).toBe(false);
    expect(validateServerMessage({ ...valid, event: { type: "MatchSnapshot", snapshot, status: "bogus" } }).ok).toBe(false);
  });

  it("supports structured stale-version rejection with a canonical snapshot", () => {
    const rejection: ServerEventEnvelope = {
      ...serverEnvelope({
        type: "CommandRejected",
        commandId: "command_01HZY8R7",
        code: "stale_match_version",
        message: "Expected version 4 but current version is 5.",
        currentMatchVersion: 5,
        snapshot,
      }),
      matchVersion: 5,
      streamSequence: null,
      recipient: { playerId: actor.playerId },
    };
    expect(validateServerMessage(rejection).ok).toBe(true);
  });

  it("permits a pre-match rejection without match identity", () => {
    const rejection: ServerEventEnvelope = {
      ...serverEnvelope({
        type: "CommandRejected",
        commandId: "command_01HZY8R7",
        code: "rate_limited",
        message: "Try again later.",
        currentMatchVersion: null,
      }),
      matchId: null,
      matchVersion: null,
      streamSequence: null,
      causationCommandId: "command_01HZY8R7",
    };
    expect(validateServerMessage(rejection).ok).toBe(true);
  });

  it("rejects accepted server events without canonical match versioning", () => {
    const invalid = {
      ...serverEnvelope({
        type: "TurnChanged",
        currentPlayer: "White",
      }),
      matchVersion: null,
    };
    const result = validateServerMessage(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.path).toBe("matchId");
  });

  it("reports invalid JSON without throwing", () => {
    const result = decodeClientMessage("{bad json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_json");
  });
});
