import type { IncomingMessage } from "node:http";
import type { AuthenticatedPrincipal } from "@assalto-reale/authoritative-server";

/** Authenticates one HTTP upgrade request before a WebSocket is accepted. */
export interface ConnectionAuthenticator {
  authenticate(
    request: IncomingMessage,
  ): Promise<AuthenticatedPrincipal | null>;
}

export interface BearerTokenVerifier {
  verify(
    token: string,
    request: IncomingMessage,
  ): Promise<AuthenticatedPrincipal | null>;
}

/**
 * Provider-neutral bearer-token adapter. Token verification remains injectable so
 * C.8.3 does not select an identity provider or account model.
 */
export class BearerTokenConnectionAuthenticator implements ConnectionAuthenticator {
  constructor(private readonly verifier: BearerTokenVerifier) {}

  async authenticate(
    request: IncomingMessage,
  ): Promise<AuthenticatedPrincipal | null> {
    const header = request.headers.authorization;
    if (typeof header !== "string") return null;
    const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
    if (!match?.[1]) return null;
    return this.verifier.verify(match[1], request);
  }
}
