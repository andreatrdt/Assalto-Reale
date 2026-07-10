import type { IncomingMessage } from "node:http";
import {
  CommandHandler,
  createInMemoryPersistence,
  type AuthenticatedPrincipal,
  type Clock,
  type IdGenerator,
  type SeedGenerator,
} from "@assalto-reale/authoritative-server";
import type {
  ClientCommand,
  OnlineMatchConfig,
  ServerEventEnvelope,
} from "@assalto-reale/multiplayer-protocol";
import { WebSocket } from "ws";
import {
  ContextualAuthenticator,
  bindCommandHandler,
  type ConnectionAuthenticator,
} from "../src/index.js";

export const ALICE = "player_alice";
export const BOB = "player_bob0001";

export const ONLINE_CONFIG: OnlineMatchConfig = {
  visibility: "invite",
  placementMode: "QuickBalanced",
  transformEnabled: false,
  preferredSide: "Black",
  timeControl: { kind: "untimed" },
};

class SequentialIds implements IdGenerator {
  private match = 0;
  private event = 0;
  private invite = 0;

  matchId(): string {
    this.match += 1;
    return `match_${String(this.match).padStart(6, "0")}`;
  }

  eventId(): string {
    this.event += 1;
    return `event_${String(this.event).padStart(8, "0")}`;
  }

  inviteCode(): string {
    this.invite += 1;
    return `INV${String(this.invite).padStart(5, "0")}`;
  }
}

class FixedClock implements Clock {
  now(): Date {
    return new Date("2026-01-01T00:00:00.000Z");
  }
}

class SequentialSeeds implements SeedGenerator {
  private seed = 1000;

  next(): number {
    this.seed += 1;
    return this.seed;
  }
}

export class TokenConnectionAuthenticator implements ConnectionAuthenticator {
  constructor(
    private readonly tokens: Readonly<Record<string, AuthenticatedPrincipal>>,
  ) {}

  async authenticate(
    request: IncomingMessage,
  ): Promise<AuthenticatedPrincipal | null> {
    const header = request.headers.authorization;
    if (typeof header !== "string") return null;
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];
    return token ? (this.tokens[token] ?? null) : null;
  }
}

export function applicationHarness(): {
  handler: CommandHandler;
  contextualAuthenticator: ContextualAuthenticator;
  executor: ReturnType<typeof bindCommandHandler>;
} {
  const persistence = createInMemoryPersistence();
  const contextualAuthenticator = new ContextualAuthenticator();
  const handler = new CommandHandler({
    matches: persistence.matches,
    unitOfWork: persistence.unitOfWork,
    authenticator: contextualAuthenticator,
    clock: new FixedClock(),
    ids: new SequentialIds(),
    seeds: new SequentialSeeds(),
  });
  return {
    handler,
    contextualAuthenticator,
    executor: bindCommandHandler(handler, contextualAuthenticator),
  };
}

export function commandMessage(
  command: ClientCommand,
  options: {
    commandId: string;
    playerId: string;
    sessionId?: string;
    matchId?: string | null;
    expectedMatchVersion?: number | null;
  },
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

export function openSocket(
  url: string,
  options: { token?: string; origin?: string } = {},
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.origin) headers.origin = options.origin;
    const socket = new WebSocket(url, { headers });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

export function rejectedSocket(
  url: string,
  expectedStatus: number,
  options: { token?: string; origin?: string } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.origin) headers.origin = options.origin;
    const socket = new WebSocket(url, { headers });
    socket.once("open", () =>
      reject(new Error("WebSocket unexpectedly opened.")),
    );
    socket.once("unexpected-response", (_request, response) => {
      if (response.statusCode === expectedStatus) resolve();
      else
        reject(
          new Error(`Expected ${expectedStatus}, got ${response.statusCode}.`),
        );
      response.resume();
    });
    socket.once("error", () => undefined);
  });
}

export function nextEnvelope(socket: WebSocket): Promise<ServerEventEnvelope> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData): void => {
      cleanup();
      try {
        resolve(JSON.parse(data.toString()) as ServerEventEnvelope);
      } catch (error) {
        reject(error);
      }
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("Socket closed before receiving an envelope."));
    };
    const cleanup = (): void => {
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
    socket.on("message", onMessage);
    socket.on("close", onClose);
  });
}

export function nextEnvelopes(
  socket: WebSocket,
  count: number,
): Promise<ServerEventEnvelope[]> {
  return new Promise((resolve, reject) => {
    const envelopes: ServerEventEnvelope[] = [];
    const onMessage = (data: WebSocket.RawData): void => {
      try {
        envelopes.push(JSON.parse(data.toString()) as ServerEventEnvelope);
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      if (envelopes.length === count) {
        cleanup();
        resolve(envelopes);
      }
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("Socket closed before receiving all envelopes."));
    };
    const cleanup = (): void => {
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
    socket.on("message", onMessage);
    socket.on("close", onClose);
  });
}

export function closeCode(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once("close", (code) => resolve(code));
  });
}

export function sendJson(socket: WebSocket, value: unknown): void {
  socket.send(JSON.stringify(value));
}
