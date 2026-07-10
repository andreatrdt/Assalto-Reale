import { cloneMatchState } from "@assalto-reale/game-core";
import type { MatchAggregate } from "../domain/matchAggregate.js";
import {
  CommandAlreadyProcessedError,
  ConcurrencyConflictError,
  ReceiptConflictError,
  type MatchPrecondition,
  type MatchRepository,
  type StoredCommandReceipt,
  type Transaction,
  type UnitOfWork,
} from "../repositories.js";

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneAggregate(aggregate: MatchAggregate): MatchAggregate {
  return {
    ...aggregate,
    config: jsonClone(aggregate.config),
    members: { ...aggregate.members },
    state: cloneMatchState(aggregate.state),
  };
}

function cloneReceipt(receipt: StoredCommandReceipt): StoredCommandReceipt {
  return {
    ...receipt,
    envelopes: jsonClone(receipt.envelopes),
  };
}

/** Shared in-memory storage used by deterministic application-core tests. */
export class InMemoryStore {
  readonly matches = new Map<string, MatchAggregate>();
  readonly receipts = new Map<string, StoredCommandReceipt>();
  readonly invites = new Map<string, string>();

  getByInvite(inviteCode: string): MatchAggregate | null {
    const matchId = this.invites.get(inviteCode);
    return matchId ? (this.matches.get(matchId) ?? null) : null;
  }
}

export class InMemoryMatchRepository implements MatchRepository {
  constructor(private readonly store: InMemoryStore) {}

  async load(matchId: string): Promise<MatchAggregate | null> {
    const found = this.store.matches.get(matchId);
    return found ? cloneAggregate(found) : null;
  }

  async findByInviteCode(inviteCode: string): Promise<MatchAggregate | null> {
    const found = this.store.getByInvite(inviteCode);
    return found ? cloneAggregate(found) : null;
  }
}

interface StagedMatch {
  aggregate: MatchAggregate;
  precondition: MatchPrecondition;
}

class InMemoryTransaction implements Transaction {
  readonly stagedMatches: StagedMatch[] = [];
  readonly stagedReceipts: StoredCommandReceipt[] = [];

  constructor(private readonly store: InMemoryStore) {}

  async loadMatch(matchId: string): Promise<MatchAggregate | null> {
    const found = this.store.matches.get(matchId);
    return found ? cloneAggregate(found) : null;
  }

  async findMatchByInviteCode(
    inviteCode: string,
  ): Promise<MatchAggregate | null> {
    const found = this.store.getByInvite(inviteCode);
    return found ? cloneAggregate(found) : null;
  }

  async findReceipt(commandId: string): Promise<StoredCommandReceipt | null> {
    const receipt = this.store.receipts.get(commandId);
    return receipt ? cloneReceipt(receipt) : null;
  }

  saveMatch(aggregate: MatchAggregate, precondition: MatchPrecondition): void {
    this.stagedMatches.push({
      aggregate: cloneAggregate(aggregate),
      precondition,
    });
  }

  saveReceipt(receipt: StoredCommandReceipt): void {
    this.stagedReceipts.push(cloneReceipt(receipt));
  }
}

export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(private readonly store: InMemoryStore) {}

  async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const tx = new InMemoryTransaction(this.store);
    const result = await work(tx);
    // Commit is synchronous, so optimistic checks and all writes form one atomic
    // critical section in the in-memory adapter.
    this.commit(tx);
    return result;
  }

  private commit(tx: InMemoryTransaction): void {
    // Receipt checks happen first. A concurrent exact retry must not persist a
    // second match or second state transition before its committed result is
    // replayed.
    for (const staged of tx.stagedReceipts) {
      const existing = this.store.receipts.get(staged.commandId);
      if (!existing) continue;
      if (
        existing.payloadHash !== staged.payloadHash ||
        existing.playerId !== staged.playerId
      ) {
        throw new ReceiptConflictError();
      }
      throw new CommandAlreadyProcessedError(cloneReceipt(existing));
    }

    for (const staged of tx.stagedMatches) {
      const current = this.store.matches.get(staged.aggregate.matchId);
      if (staged.precondition.kind === "create") {
        if (current || this.store.invites.has(staged.aggregate.inviteCode)) {
          throw new ConcurrencyConflictError(
            "A match with this id or invite code already exists.",
          );
        }
      } else if (!current || current.version !== staged.precondition.version) {
        throw new ConcurrencyConflictError();
      }
    }

    for (const staged of tx.stagedMatches) {
      const aggregate = cloneAggregate(staged.aggregate);
      this.store.matches.set(aggregate.matchId, aggregate);
      this.store.invites.set(aggregate.inviteCode, aggregate.matchId);
    }
    for (const staged of tx.stagedReceipts) {
      this.store.receipts.set(staged.commandId, cloneReceipt(staged));
    }
  }
}

export interface InMemoryPersistence {
  store: InMemoryStore;
  matches: MatchRepository;
  unitOfWork: UnitOfWork;
}

export function createInMemoryPersistence(
  store: InMemoryStore = new InMemoryStore(),
): InMemoryPersistence {
  return {
    store,
    matches: new InMemoryMatchRepository(store),
    unitOfWork: new InMemoryUnitOfWork(store),
  };
}
