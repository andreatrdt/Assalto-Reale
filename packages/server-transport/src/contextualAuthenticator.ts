import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthenticatedPrincipal, Authenticator, CommandHandler, PostGamePresenceUpdate } from "@assalto-reale/authoritative-server";
import type { ClientCommandEnvelope, ServerEventEnvelope } from "@assalto-reale/multiplayer-protocol";

/** Executes application commands as a principal authenticated by the transport. */
export interface AuthenticatedCommandExecutor {
  execute(principal: AuthenticatedPrincipal, rawMessage: unknown): Promise<ServerEventEnvelope[]>;
  postGameDisconnected?(principal: AuthenticatedPrincipal, matchId: string): Promise<PostGamePresenceUpdate>;
  expirePostGameDisconnect?(principal: AuthenticatedPrincipal, matchId: string): Promise<PostGamePresenceUpdate>;
}

/**
 * Bridges a connection-authenticated principal into the existing application-core
 * `Authenticator` port without putting transport state into command envelopes.
 */
export class ContextualAuthenticator implements Authenticator {
  private readonly principals = new AsyncLocalStorage<AuthenticatedPrincipal>();

  async authenticate(_envelope: ClientCommandEnvelope): Promise<AuthenticatedPrincipal | null> {
    const principal = this.principals.getStore();
    return principal ? { ...principal } : null;
  }

  run<T>(principal: AuthenticatedPrincipal, work: () => Promise<T>): Promise<T> {
    return this.principals.run({ ...principal }, work);
  }
}

/**
 * Binds a `CommandHandler` to the same contextual authenticator injected into its
 * dependencies. The transport calls only this executor.
 */
export function bindCommandHandler(
  handler: Pick<CommandHandler, "handle"> & Partial<Pick<CommandHandler, "markPostGameDisconnected" | "expirePostGameDisconnect">>,
  authenticator: ContextualAuthenticator,
): AuthenticatedCommandExecutor {
  const executor: AuthenticatedCommandExecutor = {
    execute: (principal, rawMessage) => authenticator.run(principal, () => handler.handle(rawMessage)),
  };
  if (handler.markPostGameDisconnected) {
    executor.postGameDisconnected = (principal, matchId) => handler.markPostGameDisconnected!(principal, matchId);
  }
  if (handler.expirePostGameDisconnect) {
    executor.expirePostGameDisconnect = (principal, matchId) => handler.expirePostGameDisconnect!(principal, matchId);
  }
  return executor;
}
