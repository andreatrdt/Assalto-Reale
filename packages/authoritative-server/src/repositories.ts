import type { ServerEventEnvelope } from "@assalto-reale/multiplayer-protocol";
import type { MatchAggregate } from "./domain/matchAggregate.js";

/**
 * Stored idempotency result. Exact retries replay these envelopes verbatim;
 * reusing the commandId for another semantic command is rejected.
 */
export interface StoredCommandReceipt {
  commandId: string;
  playerId: string;
  matchId: string | null;
  payloadHash: string;
  envelopes: ServerEventEnvelope[];
}

export type MatchPrecondition = { kind: "create" } | { kind: "expectedVersion"; version: number };

export class ConcurrencyConflictError extends Error {
  constructor(message = "The match changed since it was loaded.") {
    super(message);
    this.name = "ConcurrencyConflictError";
  }
}

export class ReceiptConflictError extends Error {
  constructor(message = "The commandId is already associated with a different command.") {
    super(message);
    this.name = "ReceiptConflictError";
  }
}

/**
 * Raised at commit time when another concurrent transaction already committed
 * the same semantic command. The handler replays the committed receipt instead
 * of returning a stale-version error.
 */
export class CommandAlreadyProcessedError extends Error {
  constructor(readonly receipt: StoredCommandReceipt) {
    super("The command was already processed by a concurrent transaction.");
    this.name = "CommandAlreadyProcessedError";
  }
}

/**
 * A transactional boundary. Reads see committed state; writes are staged and
 * applied atomically only if the whole unit of work succeeds and every
 * precondition still holds at commit time.
 */
export interface Transaction {
  loadMatch(matchId: string): Promise<MatchAggregate | null>;
  findMatchByInviteCode(inviteCode: string): Promise<MatchAggregate | null>;
  findReceipt(commandId: string): Promise<StoredCommandReceipt | null>;
  saveMatch(aggregate: MatchAggregate, precondition: MatchPrecondition): void;
  saveReceipt(receipt: StoredCommandReceipt): void;
}

export interface UnitOfWork {
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}

/** Read-only repository for diagnostics and post-conflict canonical snapshots. */
export interface MatchRepository {
  load(matchId: string): Promise<MatchAggregate | null>;
  findByInviteCode(inviteCode: string): Promise<MatchAggregate | null>;
}
