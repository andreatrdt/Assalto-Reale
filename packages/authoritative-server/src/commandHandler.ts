import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  validateClientMessage,
  type CanonicalMatchSnapshot,
  type ClientCommandEnvelope,
  type CommandRejectionCode,
  type ProtocolValidationError,
  type ServerEvent,
  type ServerEventEnvelope,
} from "@assalto-reale/multiplayer-protocol";
import {
  applyGameCommand,
  createMatchAggregate,
  isProtocolGameCommand,
  joinMatchAggregate,
  memberSide,
  resignAggregate,
  syncEmission,
  type Emission,
  type MatchAggregate,
  type OperationOutcome,
} from "./domain/matchAggregate.js";
import type { Authenticator, Clock, IdGenerator, SeedGenerator } from "./ports.js";
import {
  CommandAlreadyProcessedError,
  ConcurrencyConflictError,
  ReceiptConflictError,
  type MatchRepository,
  type Transaction,
  type UnitOfWork,
} from "./repositories.js";
import { snapshotOf } from "./protocol/translate.js";

export interface CommandHandlerDeps {
  matches: MatchRepository;
  unitOfWork: UnitOfWork;
  authenticator: Authenticator;
  clock: Clock;
  ids: IdGenerator;
  seeds: SeedGenerator;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Fingerprint the semantic command, not transport diagnostics. `sentAt` and the
 * session id may legitimately change when the same player retries after a
 * reconnect; actor, target, expected version and payload may not.
 */
function commandFingerprint(envelope: ClientCommandEnvelope): string {
  return stableStringify({
    protocol: envelope.protocol,
    protocolVersion: envelope.protocolVersion,
    playerId: envelope.actor.playerId,
    matchId: envelope.matchId,
    expectedMatchVersion: envelope.expectedMatchVersion,
    command: envelope.command,
  });
}

function validationRejectionCode(error: ProtocolValidationError): CommandRejectionCode {
  return error.code === "unsupported_protocol_version" ? "unsupported_protocol_version" : "invalid_message";
}

export class CommandHandler {
  constructor(private readonly deps: CommandHandlerDeps) {}

  async handle(rawMessage: unknown): Promise<ServerEventEnvelope[]> {
    const parsed = validateClientMessage(rawMessage);
    if (!parsed.ok) {
      const commandId = this.correlationId(rawMessage);
      return [this.rejection(commandId, null, validationRejectionCode(parsed.error), parsed.error.message, null, null, "all")];
    }
    const envelope = parsed.value;

    const principal = await this.deps.authenticator.authenticate(envelope);
    if (!principal) {
      return [
        this.rejection(
          envelope.commandId,
          envelope.matchId,
          "unauthenticated",
          "The command is not authenticated.",
          null,
          null,
          "all",
        ),
      ];
    }
    if (principal.playerId !== envelope.actor.playerId) {
      return [
        this.rejection(
          envelope.commandId,
          envelope.matchId,
          "unauthorized",
          "The authenticated principal does not match the actor.",
          null,
          null,
          { playerId: principal.playerId },
        ),
      ];
    }

    return this.handleAuthenticated(envelope, principal.playerId);
  }

  private async handleAuthenticated(envelope: ClientCommandEnvelope, playerId: string): Promise<ServerEventEnvelope[]> {
    const payloadHash = commandFingerprint(envelope);
    try {
      return await this.deps.unitOfWork.run(async (tx) => {
        const existing = await tx.findReceipt(envelope.commandId);
        if (existing) {
          if (existing.payloadHash !== payloadHash || existing.playerId !== playerId) {
            return [this.duplicateRejection(envelope, playerId)];
          }
          return existing.envelopes;
        }

        const envelopes = await this.process(tx, envelope, playerId);
        tx.saveReceipt({
          commandId: envelope.commandId,
          playerId,
          matchId: envelopes[0]?.matchId ?? envelope.matchId,
          payloadHash,
          envelopes,
        });
        return envelopes;
      });
    } catch (error) {
      if (error instanceof CommandAlreadyProcessedError) {
        if (error.receipt.payloadHash === payloadHash && error.receipt.playerId === playerId) {
          return error.receipt.envelopes;
        }
        return [this.duplicateRejection(envelope, playerId)];
      }
      if (error instanceof ReceiptConflictError) {
        return [this.duplicateRejection(envelope, playerId)];
      }
      if (error instanceof ConcurrencyConflictError) {
        const current = envelope.matchId ? await this.deps.matches.load(envelope.matchId) : null;
        return [
          this.rejection(
            envelope.commandId,
            envelope.matchId,
            "stale_match_version",
            "The match changed concurrently; retry with the current version.",
            current?.version ?? null,
            current ? snapshotOf(current.state) : null,
            { playerId },
          ),
        ];
      }
      throw error;
    }
  }

  private async process(tx: Transaction, envelope: ClientCommandEnvelope, playerId: string): Promise<ServerEventEnvelope[]> {
    const command = envelope.command;
    const recipient = { playerId } as const;

    if (command.type === "CreateMatch") {
      const created = createMatchAggregate({
        matchId: this.deps.ids.matchId(),
        inviteCode: this.deps.ids.inviteCode(),
        seed: this.deps.seeds.next(),
        config: command.config,
        creatorPlayerId: playerId,
      });
      tx.saveMatch(created.aggregate, { kind: "create" });
      return this.envelopesFor(created.emissions, created.aggregate.matchId, envelope.commandId);
    }

    if (command.type === "JoinMatch") {
      const aggregate = envelope.matchId
        ? await tx.loadMatch(envelope.matchId)
        : await tx.findMatchByInviteCode(command.inviteCode);
      if (!aggregate) {
        return [
          this.rejection(
            envelope.commandId,
            envelope.matchId,
            envelope.matchId ? "match_not_found" : "invite_invalid",
            envelope.matchId ? "The match does not exist." : "The invitation code is invalid.",
            null,
            null,
            recipient,
          ),
        ];
      }
      if (aggregate.inviteCode !== command.inviteCode) {
        return [
          this.rejection(
            envelope.commandId,
            aggregate.matchId,
            "invite_invalid",
            "The invite code is not valid for this match.",
            aggregate.version,
            null,
            recipient,
          ),
        ];
      }
      return this.commit(tx, aggregate, joinMatchAggregate(aggregate, playerId), envelope, recipient);
    }

    const matchId = envelope.matchId;
    if (!matchId) {
      return [this.rejection(envelope.commandId, null, "match_not_found", "No match was targeted.", null, null, recipient)];
    }
    const aggregate = await tx.loadMatch(matchId);
    if (!aggregate) {
      return [this.rejection(envelope.commandId, matchId, "match_not_found", "The match does not exist.", null, null, recipient)];
    }
    const actorSide = memberSide(aggregate, playerId);
    if (!actorSide) {
      return [
        this.rejection(
          envelope.commandId,
          matchId,
          "unauthorized",
          "Only match members may issue commands.",
          aggregate.version,
          null,
          recipient,
        ),
      ];
    }

    if (command.type === "RequestSync") {
      return [this.envelopeFor(syncEmission(aggregate, playerId), matchId, envelope.commandId)];
    }

    if (envelope.expectedMatchVersion !== aggregate.version) {
      return [
        this.rejection(
          envelope.commandId,
          matchId,
          "stale_match_version",
          `Expected version ${envelope.expectedMatchVersion}, current is ${aggregate.version}.`,
          aggregate.version,
          snapshotOf(aggregate.state),
          recipient,
        ),
      ];
    }

    if (command.type === "Resign") {
      return this.commit(tx, aggregate, resignAggregate(aggregate, actorSide), envelope, recipient);
    }
    if (isProtocolGameCommand(command)) {
      return this.commit(tx, aggregate, applyGameCommand(aggregate, actorSide, command), envelope, recipient);
    }

    return [
      this.rejection(
        envelope.commandId,
        matchId,
        "illegal_command",
        "Rematch is not supported until the invite-multiplayer phase.",
        aggregate.version,
        null,
        recipient,
      ),
    ];
  }

  private commit(
    tx: Transaction,
    previous: MatchAggregate,
    outcome: OperationOutcome,
    envelope: ClientCommandEnvelope,
    recipient: { playerId: string },
  ): ServerEventEnvelope[] {
    if (!outcome.ok) {
      return [
        this.rejection(
          envelope.commandId,
          previous.matchId,
          outcome.code,
          outcome.message,
          outcome.version,
          outcome.snapshot,
          recipient,
        ),
      ];
    }
    tx.saveMatch(outcome.aggregate, { kind: "expectedVersion", version: previous.version });
    return this.envelopesFor(outcome.emissions, outcome.aggregate.matchId, envelope.commandId);
  }

  private envelopesFor(emissions: Emission[], matchId: string, commandId: string): ServerEventEnvelope[] {
    return emissions.map((emission) => this.envelopeFor(emission, matchId, commandId));
  }

  private envelopeFor(emission: Emission, matchId: string, commandId: string): ServerEventEnvelope {
    return {
      protocol: PROTOCOL_NAME,
      protocolVersion: PROTOCOL_VERSION,
      messageType: "event",
      eventId: this.deps.ids.eventId(),
      emittedAt: this.deps.clock.now().toISOString(),
      matchId,
      matchVersion: emission.matchVersion,
      streamSequence: emission.streamSequence,
      causationCommandId: commandId,
      recipient: emission.recipient,
      event: emission.event,
    };
  }

  private duplicateRejection(envelope: ClientCommandEnvelope, playerId: string): ServerEventEnvelope {
    return this.rejection(
      envelope.commandId,
      envelope.matchId,
      "duplicate_command",
      "commandId was reused with a different semantic command.",
      null,
      null,
      { playerId },
    );
  }

  private rejection(
    commandId: string,
    matchId: string | null,
    code: CommandRejectionCode,
    message: string,
    currentMatchVersion: number | null,
    snapshot: CanonicalMatchSnapshot | null,
    recipient: "all" | { playerId: string },
  ): ServerEventEnvelope {
    const event: ServerEvent = {
      type: "CommandRejected",
      commandId,
      code,
      message,
      currentMatchVersion,
      ...(snapshot ? { snapshot } : {}),
    };
    return {
      protocol: PROTOCOL_NAME,
      protocolVersion: PROTOCOL_VERSION,
      messageType: "event",
      eventId: this.deps.ids.eventId(),
      emittedAt: this.deps.clock.now().toISOString(),
      matchId,
      matchVersion: currentMatchVersion,
      streamSequence: null,
      causationCommandId: commandId,
      recipient,
      event,
    };
  }

  private correlationId(rawMessage: unknown): string {
    if (rawMessage && typeof rawMessage === "object") {
      const candidate = (rawMessage as Record<string, unknown>).commandId;
      if (typeof candidate === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(candidate)) return candidate;
    }
    return this.deps.ids.eventId();
  }
}
