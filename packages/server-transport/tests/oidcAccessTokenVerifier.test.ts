import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { OidcAccessTokenVerifier } from "../src/index.js";

const SESSION_CLAIM = "https://assalto.example/session_id";
const AUDIENCE = "https://api.assalto.example";
const NOW = new Date("2028-01-01T00:00:00.000Z");

describe("OIDC access-token verifier", () => {
  let server: Server;
  let issuer: string;
  let privateKey: CryptoKey;
  let verifier: OidcAccessTokenVerifier;

  beforeAll(async () => {
    const keys = await generateKeyPair("RS256", { extractable: true });
    privateKey = keys.privateKey;
    const jwk = await exportJWK(keys.publicKey);
    server = createServer((request, response) => {
      if (request.url === "/.well-known/jwks.json") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }],
          }),
        );
      } else {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("JWKS test server did not bind.");
    issuer = `http://127.0.0.1:${address.port}/`;
    verifier = new OidcAccessTokenVerifier({
      issuer,
      audience: AUDIENCE,
      sessionIdClaim: SESSION_CLAIM,
      now: () => NOW,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function token(
    overrides: {
      audience?: string;
      expiry?: number;
      session?: string | null;
    } = {},
  ) {
    const jwt = new SignJWT({
      email: "PLAYER@EXAMPLE.TEST",
      email_verified: true,
      ...(overrides.session === null
        ? {}
        : { [SESSION_CLAIM]: overrides.session ?? "provider-session-001" }),
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(overrides.audience ?? AUDIENCE)
      .setSubject("auth0|player001")
      .setIssuedAt(Math.floor(NOW.getTime() / 1000) - 60)
      .setExpirationTime(
        overrides.expiry ?? Math.floor(NOW.getTime() / 1000) + 3600,
      );
    return jwt.sign(privateKey);
  }

  it("accepts only a signed, issuer/audience-bound, unexpired token with a stable session claim", async () => {
    await expect(verifier.verify(await token())).resolves.toEqual({
      issuer,
      providerSubject: "auth0|player001",
      providerSessionId: "provider-session-001",
      expiresAt: new Date("2028-01-01T01:00:00.000Z"),
      verifiedEmail: "player@example.test",
    });
    await expect(
      verifier.verify(await token({ audience: "wrong" })),
    ).resolves.toBeNull();
    await expect(
      verifier.verify(
        await token({ expiry: Math.floor(NOW.getTime() / 1000) - 1 }),
      ),
    ).resolves.toBeNull();
    await expect(
      verifier.verify(await token({ session: null })),
    ).resolves.toBeNull();
    await expect(verifier.verify("not-a-jwt")).resolves.toBeNull();
  });
});
