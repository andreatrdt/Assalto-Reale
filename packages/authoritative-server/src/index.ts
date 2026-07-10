// Authoritative multiplayer server — application/domain core (Phase C.8.1).
// Transport-, database- and framework-independent. The only game-rules authority
// is @assalto-reale/game-core; the wire contract is @assalto-reale/multiplayer-protocol.
export { CommandHandler, type CommandHandlerDeps } from "./commandHandler.js";
export type {
  AuthenticatedPrincipal,
  Authenticator,
  Clock,
  IdGenerator,
  SeedGenerator,
} from "./ports.js";
export {
  CommandAlreadyProcessedError,
  ConcurrencyConflictError,
  ReceiptConflictError,
  type MatchPrecondition,
  type MatchRepository,
  type StoredCommandReceipt,
  type Transaction,
  type UnitOfWork,
} from "./repositories.js";
export {
  InMemoryMatchRepository,
  InMemoryStore,
  InMemoryUnitOfWork,
  createInMemoryPersistence,
  type InMemoryPersistence,
} from "./persistence/inMemory.js";
export type {
  Emission,
  MatchAggregate,
  MatchMembers,
  MatchStatus,
  OperationOutcome,
} from "./domain/matchAggregate.js";
