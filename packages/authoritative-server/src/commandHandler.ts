import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  validateClientMessage,
  type CanonicalMatchSnapshot,
  type ClientCommand,
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
import { ConcurrencyConflictError, type MatchRepository, type Transaction, type UnitOfWork } from "./repositories.js";
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
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
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
      return [this.rejection(commandId, null, validationRejectionCode(parsed.error), parsed.error.message, null, null)];
    }
    const envelope = parsed.value;

    const principal = await this.deps.authenticator.authenticate(envelope);
    if (!principal) {
      return [this.rejection(envelope.commandId, envelope.matchId, "unauthenticated", "The command is not authenticated.", null, null)];
    }
    if (principal.playerId !== envelope.actor.playerId) {
      return [
        this.rejection(envelope.commandId, envelope.matchId, "unauthorized", "The authenticated principal does not match the actor.", null, null),
      ];
    }

    if (envelope.command.type === "RequestSync") {
      return this.handleSync(envelope, principal.playerId);
    }
    return this.handleMutation(envelope, principal.playerId);
  }

  private async handleSync(envelope: ClientCommandEnvelope, playerId: string): Promise<ServerEventEnvelope[]> {
    const matchId = envelope.matchId;
    if (!matchId) {
      return [this.rejection(envelope.commandId, null, "match_not_found", "No match was targeted.", null, null)];
    }
    const aggregate = await this.deps.matches.load(matchId);
    if (!aggregate) {
      return [this.rejection(envelope.commandId, matchId, "match_not_found", "The match does not exist.", null, null)];
    }
    if (!memberSide(aggregate, playerId)) {
      return [this.rejection(envelope.commandId, matchId, "unauthorized", "Only match members may sync.", aggregate.version, null)];
    }
    return [this.envelopeFor(syncEmission(aggregate, playerId), matchId, envelope.commandId)];
  }

  private async handleMutation(envelope: ClientCommandEnvelope, playerId: string): Promise<ServerEventEnvelope[]> {
    const payloadHash = stableStringify(envelope.command);
    try {
      return await this.deps.unitOfWork.run(async (tx) => {
        const existing = await tx.findReceipt(envelope.commandId);
        if (existing) {
          if (existing.payloadHash !== payloadHash) {
            return [this.rejection(envelope.commandId, envelope.matchId, "duplicate_command", "commandId was reused with a different payload.", null, null)];
          }
          return existing.envelopes;
        }

        const envelopes = await this.process(tx, envelope, playerId);
        tx.saveReceipt({ commandId: envelope.commandId, playerId, matchId: envelope.matchId, payloadHash, envelopes });
        return envelopes;
      });
    } catch (error) {
      if (error instanceof ConcurrencyConflictError) {
        return [this.rejection(envelope.commandId, envelope.matchId, "stale_match_version", "The match changed concurrently; retry with the current version.", null, null)];
      }
      throw error;
    }
  }

  private async process(tx: Transaction, envelope: ClientCommandEnvelope, playerId: string): Promise<ServerEventEnvelope[]> {
    const command = envelope.command;

    if (command.type === "CreateMatch") {
      const seed = this.deps.seeds.next();
      const created = createMatchAggregate({
        matchId: this.deps.ids.matchId(),
        inviteCode: this.deps.ids.inviteCode(),
        seed,
        config: command.config,
        creatorPlayerId: playerId,
      });
      tx.saveMatch(created.aggregate, { kind: "create" });
      return this.envelopesFor(created.emissions, created.aggregate.matchId, envelope.commandId);
    }

    if (command.type === "JoinMatch") {
      const matchId = envelope.matchId;
      if (!matchId) return [this.rejection(envelope.commandId, null, "match_not_found", "No match was targeted.", null, null)];
      const aggregate = await tx.loadMatch(matchId);
      if (!aggregate) return [this.rejection(envelope.commandId, matchId, "match_not_found", "The match does not exist.", null, null)];
      if (aggregate.inviteCode !== command.inviteCode) {
        return [this.rejection(envelope.commandId, matchId, "invite_invalid", "The invite code is not valid for this match.", aggregate.version, null)];
      }
      return this.commit(tx, aggregate, joinMatchAggregate(aggregate, playerId), envelope);
    }

    // Remaining commands require membership and (for state-changers) a version.
    const matchId = envelope.matchId;
    if (!matchId) return [this.rejection(envelope.commandId, null, "match_not_found", "No match was targeted.", null, null)];
    const aggregate = await tx.loadMatch(matchId);
    if (!aggregate) return [this.rejection(envelope.commandId, matchId, "match_not_found", "The match does not exist.", null, null)];
    const actorSide = memberSide(aggregate, playerId);
    if (!actorSide) {
      return [this.rejection(envelope.commandId, matchId, "unauthorized", "Only match members may issue commands.", aggregate.version, null)];
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
        ),
      ];
    }

    if (command.type === "Resign") {
      return this.commit(tx, aggregate, resignAggregate(aggregate, actorSide), envelope);
    }
    if (isProtocolGameCommand(command)) {
      return this.commit(tx, aggregate, applyGameCommand(aggregate, actorSide, command), envelope);
    }
    // OfferRematch / RespondToRematch are deferred to Phase C.9; reject cleanly
    // rather than pretend to support them in the C.8.1 application core.
    return [this.rejection(envelope.commandId, matchId, "illegal_command", "Rematch is not supported yet.", aggregate.version, null)];
  }

  private commit(tx: Transaction, previous: MatchAggregate, outcome: OperationOutcome, envelope: ClientCommandEnvelope): ServerEventEnvelope[] {
    if (!outcome.ok) {
      return [this.rejection(envelope.commandId, previous.matchId, outcome.code, outcome.message, outcome.version, outcome.snapshot)];
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

  private rejection(
    commandId: string,
    matchId: string | null,
    code: CommandRejectionCode,
    message: string,
    currentMatchVersion: number | null,
    snapshot: CanonicalMatchSnapshot | null,
  ): ServerEventEnvelope {
    const event: ServerEvent = { type: "CommandRejected", commandId, code, message, currentMatchVersion, ...(snapshot ? { snapshot } : {}) };
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
      recipient: "all",
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
