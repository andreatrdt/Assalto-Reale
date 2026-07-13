import { expect } from "vitest";
import { WebSocket } from "ws";
import type {
  CanonicalMatchSnapshot,
  ServerEvent,
  ClientCommand,
  ServerEventEnvelope,
} from "@assalto-reale/multiplayer-protocol";

export const TEST_ORIGIN = "http://localhost:5173";
export const TEST_SECRET = "operational-runtime-test-secret-0123456789";

/**
 * Extract the canonical snapshot from any event that carries one, narrowing by
 * `event.type` so no unsafe cast from the wire union is needed.
 */
export function snapshotFromEvent(event: ServerEvent): CanonicalMatchSnapshot {
  switch (event.type) {
    case "MatchCreated":
    case "PlayerJoined":
    case "MatchUpdated":
    case "MatchEnded":
    case "MatchSnapshot":
    case "RematchCreated":
      return event.snapshot;
    default:
      throw new Error(`Event ${event.type} carries no canonical snapshot.`);
  }
}

/**
 * Read placement-phase fields from a canonical snapshot. A CanonicalMatchSnapshot
 * is an opaque JSON object on the wire (game-core owns the gameplay shape), so
 * this test-only helper validates the field types before use rather than casting.
 */
export function placementView(snapshot: CanonicalMatchSnapshot): {
  phase: string;
  placementCursor: number;
} {
  const phase = snapshot.phase;
  const placementCursor = snapshot.placementCursor;
  if (typeof phase !== "string" || typeof placementCursor !== "number") {
    throw new Error("Canonical snapshot is missing placement fields.");
  }
  return { phase, placementCursor };
}

export interface GuestSession {
  token: string;
  playerId: string;
  sessionId: string;
  expiresAt: string;
}

export const QUICK_CONFIG: ClientCommand = {
  type: "CreateMatch",
  config: {
    visibility: "invite",
    placementMode: "QuickBalanced",
    transformEnabled: false,
    preferredSide: "Black",
    timeControl: { kind: "untimed" },
  },
};

// The production online configuration: manual placement, so matches open in the
// placement phase (used to exercise reconnect-during-placement).
export const MANUAL_CONFIG: ClientCommand = {
  type: "CreateMatch",
  config: {
    visibility: "invite",
    placementMode: "Manual",
    transformEnabled: false,
    preferredSide: "Black",
    timeControl: { kind: "untimed" },
  },
};

export async function acquireGuestSession(
  baseUrl: string,
  origin = TEST_ORIGIN,
): Promise<GuestSession> {
  const response = await fetch(`${baseUrl}/session`, {
    method: "POST",
    headers: { origin },
  });
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toContain("no-store");
  return (await response.json()) as GuestSession;
}

export function commandMessage(
  session: GuestSession,
  command: ClientCommand,
  options: {
    commandId: string;
    matchId?: string | null;
    expectedMatchVersion?: number | null;
  },
): string {
  return JSON.stringify({
    protocol: "assalto-reale",
    protocolVersion: 1,
    messageType: "command",
    commandId: options.commandId,
    sentAt: new Date().toISOString(),
    actor: { playerId: session.playerId, sessionId: session.sessionId },
    matchId: options.matchId ?? null,
    expectedMatchVersion: options.expectedMatchVersion ?? null,
    command,
  });
}

/** Minimal buffering WebSocket client for integration tests. */
export class TestClient {
  private readonly received: ServerEventEnvelope[] = [];
  private readonly waiters: Array<{
    match: (e: ServerEventEnvelope) => boolean;
    resolve: (e: ServerEventEnvelope) => void;
  }> = [];

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const envelope = JSON.parse(data.toString()) as ServerEventEnvelope;
      const index = this.waiters.findIndex((w) => w.match(envelope));
      if (index >= 0) this.waiters.splice(index, 1)[0]!.resolve(envelope);
      else this.received.push(envelope);
    });
  }

  static connect(
    wsBase: string,
    session: GuestSession,
    origin = TEST_ORIGIN,
  ): Promise<TestClient> {
    const socket = new WebSocket(`${wsBase}?access_token=${session.token}`, {
      headers: { origin },
    });
    return new Promise((resolve, reject) => {
      socket.once("open", () => resolve(new TestClient(socket)));
      socket.once("error", reject);
    });
  }

  static connectTicket(
    wsBase: string,
    ticket: string,
    origin = TEST_ORIGIN,
  ): Promise<TestClient> {
    const socket = new WebSocket(`${wsBase}?ticket=${ticket}`, {
      headers: { origin },
    });
    return new Promise((resolve, reject) => {
      socket.once("open", () => resolve(new TestClient(socket)));
      socket.once("error", reject);
    });
  }

  send(message: string): void {
    this.socket.send(message);
  }

  waitFor(
    type: ServerEventEnvelope["event"]["type"],
    timeoutMs = 8000,
  ): Promise<ServerEventEnvelope> {
    const match = (e: ServerEventEnvelope): boolean => e.event.type === type;
    const buffered = this.received.findIndex(match);
    if (buffered >= 0)
      return Promise.resolve(this.received.splice(buffered, 1)[0]!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for ${type}`)),
        timeoutMs,
      );
      this.waiters.push({
        match,
        resolve: (envelope) => {
          clearTimeout(timer);
          resolve(envelope);
        },
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.once("close", () => resolve());
      this.socket.close();
    });
  }
}
