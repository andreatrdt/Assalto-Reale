import {
  createBoard,
  createEmptyPiecesLeft,
  PLACEMENT_QUEUE,
  setPiece,
  type BoardState,
  type MatchState,
  type Player,
} from "@assalto-reale/game-core";
import type {
  ClientCommand,
  OnlineMatchConfig,
} from "@assalto-reale/multiplayer-protocol";
import {
  CommandHandler,
  InMemoryStore,
  createInMemoryPersistence,
  type AuthenticatedPrincipal,
  type Authenticator,
  type Clock,
  type IdGenerator,
  type MatchAggregate,
  type MatchMembers,
  type SeedGenerator,
} from "../src/index.js";

export const ALICE = "player_alice";
export const BOB = "player_bob0001";

export class SequentialIds implements IdGenerator {
  private m = 0;
  private e = 0;
  private i = 0;
  matchId(): string {
    this.m += 1;
    return `match_${String(this.m).padStart(6, "0")}`;
  }
  eventId(): string {
    this.e += 1;
    return `event_${String(this.e).padStart(8, "0")}`;
  }
  inviteCode(): string {
    this.i += 1;
    return `INV${String(this.i).padStart(5, "0")}`;
  }
}

export class FixedClock implements Clock {
  now(): Date {
    return new Date("2026-01-01T00:00:00.000Z");
  }
}

export class SequentialSeeds implements SeedGenerator {
  private n = 1000;
  next(): number {
    this.n += 1;
    return this.n;
  }
}

/** Trusts the declared actor as the authenticated principal. */
export class TrustingAuthenticator implements Authenticator {
  async authenticate(envelope: {
    actor: AuthenticatedPrincipal;
  }): Promise<AuthenticatedPrincipal | null> {
    return {
      playerId: envelope.actor.playerId,
      sessionId: envelope.actor.sessionId,
    };
  }
}

export class FixedPrincipalAuthenticator implements Authenticator {
  constructor(private readonly principal: AuthenticatedPrincipal | null) {}
  async authenticate(): Promise<AuthenticatedPrincipal | null> {
    return this.principal;
  }
}

export interface HarnessOptions {
  authenticator?: Authenticator;
  store?: InMemoryStore;
  clock?: Clock;
  postGameReconnectGraceMs?: number;
}

export function harness(options: HarnessOptions = {}): {
  handler: CommandHandler;
  store: InMemoryStore;
  ids: SequentialIds;
  seeds: SequentialSeeds;
} {
  const store = options.store ?? new InMemoryStore();
  const persistence = createInMemoryPersistence(store);
  const ids = new SequentialIds();
  const seeds = new SequentialSeeds();
  const handler = new CommandHandler({
    matches: persistence.matches,
    unitOfWork: persistence.unitOfWork,
    authenticator: options.authenticator ?? new TrustingAuthenticator(),
    clock: options.clock ?? new FixedClock(),
    ids,
    seeds,
    postGameReconnectGraceMs: options.postGameReconnectGraceMs,
  });
  return { handler, store, ids, seeds };
}

export interface MessageOptions {
  commandId: string;
  playerId: string;
  sessionId?: string;
  matchId?: string | null;
  expectedMatchVersion?: number | null;
}

export function message(
  command: ClientCommand,
  options: MessageOptions,
): unknown {
  return {
    protocol: "assalto-reale",
    protocolVersion: 1,
    messageType: "command",
    commandId: options.commandId,
    sentAt: "2026-01-01T00:00:00.000Z",
    actor: {
      playerId: options.playerId,
      sessionId: options.sessionId ?? `${options.playerId}_session`,
    },
    matchId: options.matchId ?? null,
    expectedMatchVersion: options.expectedMatchVersion ?? null,
    command,
  };
}

export const ONLINE_CONFIG: OnlineMatchConfig = {
  visibility: "invite",
  placementMode: "QuickBalanced",
  transformEnabled: false,
  preferredSide: "Black",
  timeControl: { kind: "untimed" },
};

export function playingState(
  board: BoardState,
  overrides: Partial<MatchState> = {},
): MatchState {
  return {
    board,
    phase: "playing",
    currentPlayer: "Black",
    movesThisTurn: 0,
    kingMoved: false,
    turnCounter: 0,
    placementCursor: PLACEMENT_QUEUE.length,
    currentPlacement: null,
    piecesLeft: createEmptyPiecesLeft(),
    pendingDefendedKing: null,
    pendingTransform: null,
    victory: null,
    ...overrides,
  };
}

export function boardWith(
  pieces: Array<
    [
      Player,
      "King" | "AttackPawn" | "DefensePawn" | "ConquestPawn",
      [number, number],
    ]
  >,
  transformSquares: Array<[number, number]> = [],
): BoardState {
  const board = createBoard({ transformEnabled: transformSquares.length > 0 });
  for (const [player, type, pos] of pieces) {
    setPiece(board, pos, { player, type });
  }
  // Transform scenarios must remain valid non-terminal match states. Sparse test
  // fixtures often specify only the transforming pawn, so add distant kings when
  // the scenario did not provide them explicitly.
  if (transformSquares.length > 0) {
    if (
      !pieces.some(([player, type]) => player === "Black" && type === "King")
    ) {
      setPiece(board, [10, 1], { player: "Black", type: "King" });
    }
    if (
      !pieces.some(([player, type]) => player === "White" && type === "King")
    ) {
      setPiece(board, [1, 10], { player: "White", type: "King" });
    }
  }
  board.transformSquares = transformSquares.map(([r, c]) => [r, c] as const);
  return board;
}

export function seedMatch(
  store: InMemoryStore,
  state: MatchState,
  options: {
    matchId?: string;
    inviteCode?: string;
    version?: number;
    streamSequence?: number;
    members?: MatchMembers;
    transformEnabled?: boolean;
    status?: MatchAggregate["status"];
    endReason?: MatchAggregate["endReason"];
    rematchOfferedBy?: string | null;
    successorMatchId?: string | null;
    predecessorMatchId?: string | null;
    postGame?: MatchAggregate["postGame"];
    historyEventSequence?: number;
    historyCaptureStartedAtVersion?: number | null;
  } = {},
): MatchAggregate {
  const aggregate: MatchAggregate = {
    matchId: options.matchId ?? "match_seed01",
    inviteCode: options.inviteCode ?? "SEED0001",
    version: options.version ?? 1,
    streamSequence: options.streamSequence ?? 1,
    seed: 42,
    config: {
      ...ONLINE_CONFIG,
      transformEnabled: options.transformEnabled ?? false,
    },
    members: options.members ?? { Black: ALICE, White: BOB },
    status: options.status ?? "active",
    state,
    endReason: options.endReason ?? null,
    rematchOfferedBy: options.rematchOfferedBy ?? null,
    successorMatchId: options.successorMatchId ?? null,
    predecessorMatchId: options.predecessorMatchId ?? null,
    historyEventSequence: options.historyEventSequence ?? 0,
    historyCaptureStartedAtVersion: options.historyCaptureStartedAtVersion ?? 1,
    postGame:
      options.postGame ??
      (options.status === "ended"
        ? {
            Black: { presence: "present", graceExpiresAt: null },
            White: { presence: "present", graceExpiresAt: null },
          }
        : null),
  };
  store.matches.set(aggregate.matchId, aggregate);
  store.invites.set(aggregate.inviteCode, aggregate.matchId);
  return aggregate;
}
