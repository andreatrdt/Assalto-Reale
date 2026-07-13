import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import type {
  RegisteredAccessTokenVerifier,
  VerifiedAccessToken,
} from "./registeredAuth.js";

export interface OidcAccessTokenVerifierOptions {
  issuer: string;
  audience: string;
  sessionIdClaim: string;
  algorithms?: readonly string[];
  now?: () => Date;
}

/** Auth0/OIDC JWT verification with pinned issuer, audience and algorithms. */
export class OidcAccessTokenVerifier implements RegisteredAccessTokenVerifier {
  private readonly issuer: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly algorithms: readonly string[];
  private readonly now: () => Date;

  constructor(private readonly options: OidcAccessTokenVerifierOptions) {
    this.issuer = options.issuer.endsWith("/")
      ? options.issuer
      : `${options.issuer}/`;
    this.jwks = createRemoteJWKSet(
      new URL(".well-known/jwks.json", this.issuer),
    );
    this.algorithms = options.algorithms ?? ["RS256"];
    this.now = options.now ?? (() => new Date());
  }

  async verify(token: string): Promise<VerifiedAccessToken | null> {
    try {
      const verified = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.options.audience,
        algorithms: [...this.algorithms],
        currentDate: this.now(),
      });
      const subject = verified.payload.sub;
      const expiresAtSeconds = verified.payload.exp;
      const providerSessionId = verified.payload[this.options.sessionIdClaim];
      if (
        typeof subject !== "string" ||
        subject.length === 0 ||
        typeof expiresAtSeconds !== "number" ||
        typeof providerSessionId !== "string" ||
        providerSessionId.length < 8 ||
        providerSessionId.length > 256
      ) {
        return null;
      }
      const email = verified.payload.email;
      const emailVerified = verified.payload.email_verified;
      return {
        issuer: this.issuer,
        providerSubject: subject,
        providerSessionId,
        expiresAt: new Date(expiresAtSeconds * 1_000),
        verifiedEmail:
          emailVerified === true && typeof email === "string"
            ? email.toLowerCase()
            : null,
      };
    } catch (error) {
      // Signature/claim/key mismatches are authentication failures. Network and
      // other unexpected verifier failures remain exceptions so HTTP/WS can
      // distinguish identity-provider outage from an invalid credential.
      if (error instanceof errors.JOSEError) return null;
      throw error;
    }
  }
}
