import { cloneMatchState } from "@assalto-reale/game-core";
import type { MatchAggregate } from "../domain/matchAggregate.js";
import {
  ConcurrencyConflictError,
  ReceiptConflictError,
  type MatchPrecondition,
  type MatchRepository,
  type StoredCommandReceipt,
  type Transaction,
  type UnitOfWork,
} from "../repositories.js";

function cloneAggregate(aggregate: MatchAggregate): MatchAggregate {
  return {
    ...aggregate,
    members: { ...aggregate.members },
    state: cloneMatchState(aggregate.state),
  };
}

/** Shared in-memory storage. Tests may inspect it directly. */
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

  async findMatchByInviteCode(inviteCode: string): Promise<MatchAggregate | null> {
    const found = this.store.getByInvite(inviteCode);
    return found ? cloneAggregate(found) : null;
  }

  async findReceipt(commandId: string): Promise<StoredCommandReceipt | null> {
    return this.store.receipts.get(commandId) ?? null;
  }

  saveMatch(aggregate: MatchAggregate, precondition: MatchPrecondition): void {
    this.stagedMatches.push({ aggregate: cloneAggregate(aggregate), precondition });
  }

  saveReceipt(receipt: StoredCommandReceipt): void {
    this.stagedReceipts.push(receipt);
  }
}

export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(private readonly store: InMemoryStore) {}

  async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const tx = new InMemoryTransaction(this.store);
    const result = await work(tx);
    // Synchronous commit: a single critical section so two concurrent units of
    // work cannot both satisfy the same optimistic precondition.
    this.commit(tx);
    return result;
  }

  private commit(tx: InMemoryTransaction): void {
    for (const staged of tx.stagedMatches) {
      const current = this.store.matches.get(staged.aggregate.matchId);
      if (staged.precondition.kind === "create") {
        if (current || this.store.invites.has(staged.aggregate.inviteCode)) {
          throw new ConcurrencyConflictError("A match with this id or invite code already exists.");
        }
      } else if (!current || current.version !== staged.precondition.version) {
        throw new ConcurrencyConflictError();
      }
    }
    for (const staged of tx.stagedReceipts) {
      const existing = this.store.receipts.get(staged.commandId);
      if (existing && existing.payloadHash !== staged.payloadHash) {
        throw new ReceiptConflictError();
      }
    }

    for (const staged of tx.stagedMatches) {
      this.store.matches.set(staged.aggregate.matchId, staged.aggregate);
      this.store.invites.set(staged.aggregate.inviteCode, staged.aggregate.matchId);
    }
    for (const staged of tx.stagedReceipts) {
      this.store.receipts.set(staged.commandId, staged);
    }
  }
}

export interface InMemoryPersistence {
  store: InMemoryStore;
  matches: MatchRepository;
  unitOfWork: UnitOfWork;
}

export function createInMemoryPersistence(store: InMemoryStore = new InMemoryStore()): InMemoryPersistence {
  return {
    store,
    matches: new InMemoryMatchRepository(store),
    unitOfWork: new InMemoryUnitOfWork(store),
  };
}
