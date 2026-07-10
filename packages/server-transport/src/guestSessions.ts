import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { URL } from "node:url";
import type { AuthenticatedPrincipal } from "@assalto-reale/authoritative-server";
import type { ConnectionAuthenticator } from "./connectionAuth.js";

export interface IssuedGuestSession extends AuthenticatedPrincipal {
  token: string;
  expiresAt: string;
}

export interface GuestSessionIssuer {
  issue(): Promise<IssuedGuestSession>;
}

export interface GuestSessionVerifier {
  verify(token: string): Promise<AuthenticatedPrincipal | null>;
}

interface GuestTokenPayload {
  version: 1;
  playerId: string;
  sessionId: string;
  expiresAtMs: number;
}

export interface HmacGuestSessionOptions {
  ttlMs?: number;
  now?: () => number;
  randomId?: () => string;
}

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(secret: Buffer, payload: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

function defaultRandomId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Short-lived anonymous identities for invite-only play. These are deliberately
 * not accounts: they provide reconnect identity within one browser session only.
 */
export class HmacGuestSessionService
  implements GuestSessionIssuer, GuestSessionVerifier
{
  private readonly secret: Buffer;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly randomId: () => string;

  constructor(secret: string | Buffer, options: HmacGuestSessionOptions = {}) {
    this.secret = Buffer.isBuffer(secret)
      ? Buffer.from(secret)
      : Buffer.from(secret);
    if (this.secret.length < 32) {
      throw new TypeError(
        "Guest-session secret must contain at least 32 bytes.",
      );
    }
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? defaultRandomId;
  }

  async issue(): Promise<IssuedGuestSession> {
    const suffix = this.randomId()
      .replaceAll(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 80);
    const playerId = `player_${suffix}`;
    const sessionId = `session_${this.randomId()
      .replaceAll(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 80)}`;
    if (!ID_PATTERN.test(playerId) || !ID_PATTERN.test(sessionId)) {
      throw new Error(
        "Guest-session ID generator returned an invalid identifier.",
      );
    }

    const expiresAtMs = this.now() + this.ttlMs;
    const payload: GuestTokenPayload = {
      version: 1,
      playerId,
      sessionId,
      expiresAtMs,
    };
    const encodedPayload = encode(JSON.stringify(payload));
    const encodedSignature = signature(this.secret, encodedPayload).toString(
      "base64url",
    );
    return {
      token: `${encodedPayload}.${encodedSignature}`,
      playerId,
      sessionId,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async verify(token: string): Promise<AuthenticatedPrincipal | null> {
    const [encodedPayload, encodedSignature, extra] = token.split(".");
    if (!encodedPayload || !encodedSignature || extra !== undefined)
      return null;

    let supplied: Buffer;
    try {
      supplied = Buffer.from(encodedSignature, "base64url");
    } catch {
      return null;
    }
    const expected = signature(this.secret, encodedPayload);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return null;
    }

    try {
      const payload = JSON.parse(
        decode(encodedPayload),
      ) as Partial<GuestTokenPayload>;
      if (
        payload.version !== 1 ||
        typeof payload.playerId !== "string" ||
        !ID_PATTERN.test(payload.playerId) ||
        typeof payload.sessionId !== "string" ||
        !ID_PATTERN.test(payload.sessionId) ||
        typeof payload.expiresAtMs !== "number" ||
        !Number.isFinite(payload.expiresAtMs) ||
        payload.expiresAtMs <= this.now()
      ) {
        return null;
      }
      return {
        playerId: payload.playerId,
        sessionId: payload.sessionId,
      };
    } catch {
      return null;
    }
  }
}

/** Browser-compatible connection auth using a query token or Bearer header. */
export class GuestSessionConnectionAuthenticator implements ConnectionAuthenticator {
  constructor(private readonly verifier: GuestSessionVerifier) {}

  async authenticate(
    request: IncomingMessage,
  ): Promise<AuthenticatedPrincipal | null> {
    const header = request.headers.authorization;
    const bearer =
      typeof header === "string"
        ? /^Bearer\s+([^\s]+)$/i.exec(header.trim())?.[1]
        : undefined;
    let queryToken: string | null = null;
    try {
      queryToken = new URL(
        request.url ?? "/",
        "http://transport.local",
      ).searchParams.get("access_token");
    } catch {
      queryToken = null;
    }
    const token = bearer ?? queryToken;
    return token ? this.verifier.verify(token) : null;
  }
}
