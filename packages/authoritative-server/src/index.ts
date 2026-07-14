// Authoritative multiplayer server — application/domain core (Phase C.8).
// Transport-independent. Game rules belong to @assalto-reale/game-core and the
// wire contract belongs to @assalto-reale/multiplayer-protocol.
export {
  CommandHandler,
  type CommandHandlerDeps,
  type PostGamePresenceUpdate,
} from "./commandHandler.js";
export type {
  AuthenticatedPrincipal,
  Authenticator,
  Clock,
  IdGenerator,
  SeedGenerator,
} from "./ports.js";
export {
  AccountIdentityConflictError,
  AccountSessionRevokedError,
  type AccountRepository,
  type AccountUser,
  type AccountUserStatus,
  type ActiveMatchMembership,
  type AuthIdentity,
  type AuthSession,
  type PlayerIdentity,
  type PlayerIdentityKind,
  type RegisteredIdentityClaims,
  type RegisteredSession,
} from "./accounts.js";
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
export { PostgresAccountRepository } from "./persistence/postgres/postgresAccountRepository.js";
export {
  PostgresMatchRepository,
  PostgresUnitOfWork,
  createPostgresPersistence,
  type PostgresPersistence,
} from "./persistence/postgres/postgresPersistence.js";
export {
  POSTGRES_MIGRATIONS,
  runPostgresMigrations,
  type PostgresMigration,
} from "./persistence/postgres/migrations.js";
export type {
  Emission,
  MatchAggregate,
  MatchMembers,
  MatchStatus,
  OperationOutcome,
} from "./domain/matchAggregate.js";
