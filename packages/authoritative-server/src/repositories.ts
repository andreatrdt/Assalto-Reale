import type { ServerEventEnvelope } from "@assalto-reale/multiplayer-protocol";
import type { MatchAggregate } from "./domain/matchAggregate.js";

// A stored idempotency receipt. When the same commandId is seen again with the
// same payload, the exact recorded envelopes are replayed; a different payload
// under the same commandId is a conflict.
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
  constructor(message = "A different result already exists for this command.") {
    super(message);
    this.name = "ReceiptConflictError";
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

/** Read-only repository for queries that never mutate (e.g. RequestSync). */
export interface MatchRepository {
  load(matchId: string): Promise<MatchAggregate | null>;
  findByInviteCode(inviteCode: string): Promise<MatchAggregate | null>;
}
