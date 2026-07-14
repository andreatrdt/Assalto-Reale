import { cloneMatchState } from "@assalto-reale/game-core";
import type { MatchAggregate } from "../domain/matchAggregate.js";
import {
  buildImmutableMatchHistory,
  applyMatchToPlayerStatistics,
  emptyPlayerStatistics,
  type ImmutableMatchHistoryRecord,
  type StoredHistoryEvent,
} from "../history.js";
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
  readonly historyEvents = new Map<string, StoredHistoryEvent[]>();
  readonly histories = new Map<string, ImmutableMatchHistoryRecord>();
  readonly historySuccessors = new Map<string, string>();
  readonly userByPlayer = new Map<string, string>();
  readonly statistics = new Map<
    string,
    ReturnType<typeof emptyPlayerStatistics>
  >();

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
  readonly stagedHistoryEvents: Array<{
    matchId: string;
    event: StoredHistoryEvent;
  }> = [];
  readonly stagedHistoryFinalizations: Array<{
    aggregate: MatchAggregate;
    completedAt: Date;
  }> = [];
  readonly stagedHistorySuccessors: Array<{
    predecessorMatchId: string;
    successorMatchId: string;
  }> = [];

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

  appendHistoryEvent(matchId: string, event: StoredHistoryEvent): void {
    this.stagedHistoryEvents.push({ matchId, event: jsonClone(event) });
  }

  finalizeMatchHistory(aggregate: MatchAggregate, completedAt: Date): void {
    this.stagedHistoryFinalizations.push({
      aggregate: cloneAggregate(aggregate),
      completedAt,
    });
  }

  linkHistorySuccessor(
    predecessorMatchId: string,
    successorMatchId: string,
  ): void {
    this.stagedHistorySuccessors.push({ predecessorMatchId, successorMatchId });
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

    // Build every immutable-history side effect in shadow maps before applying
    // any write. A conflict therefore cannot leave a receipt, aggregate, event,
    // summary, statistic, or lineage edge partially committed in this adapter.
    const nextHistoryEvents = new Map(
      [...this.store.historyEvents].map(([matchId, events]) => [
        matchId,
        jsonClone(events),
      ]),
    );
    const nextHistories = new Map(
      [...this.store.histories].map(([matchId, history]) => [
        matchId,
        jsonClone(history),
      ]),
    );
    const nextStatistics = new Map(
      [...this.store.statistics].map(([userId, statistics]) => [
        userId,
        jsonClone(statistics),
      ]),
    );
    const nextHistorySuccessors = new Map(this.store.historySuccessors);

    for (const staged of tx.stagedHistoryEvents) {
      const events = nextHistoryEvents.get(staged.matchId) ?? [];
      const existing = events.find(
        (event) => event.sequenceNumber === staged.event.sequenceNumber,
      );
      if (
        existing &&
        JSON.stringify(existing) !== JSON.stringify(staged.event)
      ) {
        throw new Error("Conflicting immutable in-memory replay event.");
      }
      if (!existing) events.push(jsonClone(staged.event));
      events.sort((left, right) => left.sequenceNumber - right.sequenceNumber);
      nextHistoryEvents.set(staged.matchId, events);
    }
    for (const staged of tx.stagedHistoryFinalizations) {
      const existing = nextHistories.get(staged.aggregate.matchId);
      const events = nextHistoryEvents.get(staged.aggregate.matchId) ?? [];
      const first = events[0]?.occurredAt ?? staged.completedAt.toISOString();
      const record = buildImmutableMatchHistory(staged.aggregate, events, {
        createdAt: first,
        startedAt: first,
        completedAt: staged.completedAt.toISOString(),
        blackUserId: staged.aggregate.members.Black
          ? (this.store.userByPlayer.get(staged.aggregate.members.Black) ??
            null)
          : null,
        whiteUserId: staged.aggregate.members.White
          ? (this.store.userByPlayer.get(staged.aggregate.members.White) ??
            null)
          : null,
      });
      if (existing && existing.integrityChecksum !== record.integrityChecksum) {
        throw new Error("Conflicting immutable in-memory match history.");
      }
      if (!existing) {
        nextHistories.set(record.matchId, jsonClone(record));
        for (const [userId, side] of [
          [record.blackUserId, "Black"],
          [record.whiteUserId, "White"],
        ] as const) {
          if (!userId) continue;
          const current = nextStatistics.get(userId) ?? emptyPlayerStatistics();
          nextStatistics.set(
            userId,
            applyMatchToPlayerStatistics(current, record, side),
          );
        }
      }
    }
    for (const staged of tx.stagedHistorySuccessors) {
      const existing = nextHistorySuccessors.get(staged.predecessorMatchId);
      if (existing && existing !== staged.successorMatchId)
        throw new Error("Conflicting historical successor.");
      nextHistorySuccessors.set(
        staged.predecessorMatchId,
        staged.successorMatchId,
      );
    }

    for (const staged of tx.stagedMatches) {
      const aggregate = cloneAggregate(staged.aggregate);
      this.store.matches.set(aggregate.matchId, aggregate);
      this.store.invites.set(aggregate.inviteCode, aggregate.matchId);
    }
    for (const staged of tx.stagedReceipts) {
      this.store.receipts.set(staged.commandId, cloneReceipt(staged));
    }
    this.store.historyEvents.clear();
    nextHistoryEvents.forEach((events, matchId) =>
      this.store.historyEvents.set(matchId, events),
    );
    this.store.histories.clear();
    nextHistories.forEach((history, matchId) =>
      this.store.histories.set(matchId, history),
    );
    this.store.statistics.clear();
    nextStatistics.forEach((statistics, userId) =>
      this.store.statistics.set(userId, statistics),
    );
    this.store.historySuccessors.clear();
    nextHistorySuccessors.forEach((successor, predecessor) =>
      this.store.historySuccessors.set(predecessor, successor),
    );
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
