import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import type { AuthenticatedPrincipal } from "@assalto-reale/authoritative-server";
import {
  encodeServerMessage,
  type ServerEventEnvelope,
} from "@assalto-reale/multiplayer-protocol";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { ConnectionAuthenticator } from "./connectionAuth.js";
import type { AuthenticatedCommandExecutor } from "./contextualAuthenticator.js";
import type { GuestSessionIssuer } from "./guestSessions.js";

const DEFAULT_WEBSOCKET_PATH = "/ws";
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 1_000;

const SUBSCRIPTION_EVENTS = new Set([
  "MatchCreated",
  "PlayerJoined",
  "MatchUpdated",
  "DecisionRequired",
  "TurnChanged",
  "MatchEnded",
  "MatchSnapshot",
  // A rematch announcement carries the new match id, so the accepting connection
  // subscribes to the successor and receives its live events.
  "RematchCreated",
]);

export interface ReadinessProbe {
  check(): Promise<boolean>;
}

export interface TransportLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const silentLogger: TransportLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface TransportServerOptions {
  executor: AuthenticatedCommandExecutor;
  authenticateConnection: ConnectionAuthenticator;
  guestSessions?: GuestSessionIssuer;
  readiness?: ReadinessProbe;
  logger?: TransportLogger;
  websocketPath?: string;
  allowedOrigins?: readonly string[];
  maxPayloadBytes?: number;
  maxBufferedBytes?: number;
  heartbeatIntervalMs?: number;
  shutdownGraceMs?: number;
}

export interface TransportListenOptions {
  host?: string;
  port?: number;
}

export interface TransportAddress {
  host: string;
  port: number;
  websocketPath: string;
}

interface ConnectionState {
  socket: WebSocket;
  principal: AuthenticatedPrincipal;
  matches: Set<string>;
  queue: Promise<void>;
  alive: boolean;
}

function parsePath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? "/", "http://transport.local").pathname;
  } catch {
    return "/";
  }
}

function rawDataToText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

function isPrincipal(
  value: AuthenticatedPrincipal | null,
): value is AuthenticatedPrincipal {
  return Boolean(
    value &&
    typeof value.playerId === "string" &&
    value.playerId.length > 0 &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0,
  );
}

/** Thin HTTP/WebSocket adapter around the authoritative command executor. */
export class AuthoritativeTransportServer {
  private readonly httpServer = createServer((request, response) => {
    void this.handleHttp(request, response);
  });

  private readonly websocketServer: WebSocketServer;
  private readonly connections = new Map<WebSocket, ConnectionState>();
  private readonly socketsByPlayer = new Map<string, Set<WebSocket>>();
  private readonly socketsByMatch = new Map<string, Set<WebSocket>>();
  private readonly logger: TransportLogger;
  private readonly websocketPath: string;
  private readonly allowedOrigins: Set<string> | null;
  private readonly maxBufferedBytes: number;
  private readonly heartbeatIntervalMs: number;
  private readonly shutdownGraceMs: number;
  private heartbeat: NodeJS.Timeout | null = null;
  private closing = false;
  private closePromise: Promise<void> | null = null;

  constructor(private readonly options: TransportServerOptions) {
    this.logger = options.logger ?? silentLogger;
    this.websocketPath = options.websocketPath ?? DEFAULT_WEBSOCKET_PATH;
    this.allowedOrigins = options.allowedOrigins
      ? new Set(options.allowedOrigins)
      : null;
    this.maxBufferedBytes =
      options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
    this.websocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
      clientTracking: false,
    });

    this.httpServer.on("upgrade", (request, socket, head) => {
      void this.handleUpgrade(request, socket, head);
    });
  }

  async listen(
    options: TransportListenOptions = {},
  ): Promise<TransportAddress> {
    if (this.closing) throw new Error("Transport server is closing.");
    if (this.httpServer.listening) {
      const current = this.httpServer.address();
      if (!current || typeof current === "string") {
        throw new Error("Transport server has no TCP address.");
      }
      return this.toTransportAddress(current);
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      this.httpServer.once("error", onError);
      this.httpServer.listen(
        options.port ?? 0,
        options.host ?? "127.0.0.1",
        () => {
          this.httpServer.off("error", onError);
          resolve();
        },
      );
    });
    this.startHeartbeat();

    const address = this.httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Transport server did not bind a TCP address.");
    }
    const resolved = this.toTransportAddress(address);
    this.logger.info("Authoritative transport listening.", { ...resolved });
    return resolved;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }

    this.closePromise = this.closeInternal();
    return this.closePromise;
  }

  private async closeInternal(): Promise<void> {
    for (const state of this.connections.values()) {
      state.socket.close(1001, "Server shutting down");
    }

    const forceClose = setTimeout(() => {
      for (const state of this.connections.values()) state.socket.terminate();
    }, this.shutdownGraceMs);
    forceClose.unref();

    await Promise.all([this.closeWebSockets(), this.closeHttp()]);
    clearTimeout(forceClose);
    this.logger.info("Authoritative transport stopped.");
  }

  private closeWebSockets(): Promise<void> {
    return new Promise((resolve) => {
      this.websocketServer.close(() => resolve());
    });
  }

  private closeHttp(): Promise<void> {
    if (!this.httpServer.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.httpServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private toTransportAddress(address: AddressInfo): TransportAddress {
    return {
      host: address.address,
      port: address.port,
      websocketPath: this.websocketPath,
    };
  }

  private async handleHttp(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const path = parsePath(request);
    const origin =
      typeof request.headers.origin === "string"
        ? request.headers.origin
        : null;

    if (path === "/session") {
      if (!this.options.guestSessions) {
        this.sendJson(response, 404, { status: "not_found" }, false, origin);
        return;
      }
      if (!this.isOriginAllowed(origin)) {
        this.sendJson(response, 403, { status: "forbidden" }, false);
        return;
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204, this.corsHeaders(origin));
        response.end();
        return;
      }
      if (request.method !== "POST") {
        this.sendJson(
          response,
          405,
          { status: "method_not_allowed" },
          request.method === "HEAD",
          origin,
        );
        return;
      }
      try {
        const session = await this.options.guestSessions.issue();
        this.sendJson(response, 201, session, false, origin);
      } catch (error) {
        this.logger.error("Guest session issuance failed.", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.sendJson(
          response,
          503,
          { status: "service_unavailable" },
          false,
          origin,
        );
      }
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      this.sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        request.method === "HEAD",
      );
      return;
    }
    if (path === "/healthz") {
      this.sendJson(response, 200, { status: "ok" }, request.method === "HEAD");
      return;
    }
    if (path === "/readyz") {
      let ready = true;
      try {
        ready = (await this.options.readiness?.check()) ?? true;
      } catch (error) {
        ready = false;
        this.logger.error("Readiness probe failed.", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.sendJson(
        response,
        ready ? 200 : 503,
        { status: ready ? "ready" : "not_ready" },
        request.method === "HEAD",
      );
      return;
    }
    this.sendJson(
      response,
      404,
      { status: "not_found" },
      request.method === "HEAD",
    );
  }

  private isOriginAllowed(origin: string | null): boolean {
    return !this.allowedOrigins || !origin || this.allowedOrigins.has(origin);
  }

  private corsHeaders(origin: string | null): Record<string, string> {
    if (!origin) return {};
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, accept",
      vary: "Origin",
    };
  }

  private sendJson(
    response: ServerResponse,
    statusCode: number,
    payload: unknown,
    headOnly: boolean,
    origin: string | null = null,
  ): void {
    const body = JSON.stringify(payload);
    response.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body),
      ...this.corsHeaders(origin),
    });
    response.end(headOnly ? undefined : body);
  }

  private async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    if (this.closing) {
      this.rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    if (parsePath(request) !== this.websocketPath) {
      this.rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    const origin = request.headers.origin;
    if (!this.isOriginAllowed(typeof origin === "string" ? origin : null)) {
      this.rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    let principal: AuthenticatedPrincipal | null;
    try {
      principal =
        await this.options.authenticateConnection.authenticate(request);
    } catch (error) {
      this.logger.error("Connection authentication failed unexpectedly.", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    if (!isPrincipal(principal)) {
      this.rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }

    this.websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      this.acceptConnection(websocket, principal);
    });
  }

  private rejectUpgrade(socket: Duplex, status: number, reason: string): void {
    const body = JSON.stringify({
      status: reason.toLowerCase().replaceAll(" ", "_"),
    });
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\n` +
        "Connection: close\r\n" +
        "Content-Type: application/json; charset=utf-8\r\n" +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        "\r\n" +
        body,
    );
    socket.destroy();
  }

  private acceptConnection(
    socket: WebSocket,
    principal: AuthenticatedPrincipal,
  ): void {
    const state: ConnectionState = {
      socket,
      principal: { ...principal },
      matches: new Set(),
      queue: Promise.resolve(),
      alive: true,
    };
    this.connections.set(socket, state);
    this.addToIndex(this.socketsByPlayer, principal.playerId, socket);

    socket.on("pong", () => {
      state.alive = true;
    });
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        socket.close(1003, "Text JSON messages required");
        return;
      }
      const text = rawDataToText(data);
      state.queue = state.queue
        .then(() => this.processMessage(state, text))
        .catch((error: unknown) => {
          this.logger.error("WebSocket command processing failed.", {
            playerId: state.principal.playerId,
            error: error instanceof Error ? error.message : String(error),
          });
          socket.close(1011, "Command processing failed");
        });
    });
    socket.on("close", () => this.removeConnection(state));
    socket.on("error", (error) => {
      this.logger.warn("WebSocket connection error.", {
        playerId: state.principal.playerId,
        error: error.message,
      });
    });
  }

  private async processMessage(
    state: ConnectionState,
    text: string,
  ): Promise<void> {
    let rawMessage: unknown = text;
    try {
      rawMessage = JSON.parse(text) as unknown;
    } catch {
      // CommandHandler returns the canonical structured invalid-message rejection.
    }

    const envelopes = await this.options.executor.execute(
      state.principal,
      rawMessage,
    );
    this.grantSubscriptions(state, envelopes);
    for (const envelope of envelopes) this.routeEnvelope(state, envelope);
  }

  private grantSubscriptions(
    state: ConnectionState,
    envelopes: readonly ServerEventEnvelope[],
  ): void {
    for (const envelope of envelopes) {
      if (envelope.matchId && SUBSCRIPTION_EVENTS.has(envelope.event.type)) {
        this.subscribe(state, envelope.matchId);
      }
    }
  }

  private subscribe(state: ConnectionState, matchId: string): void {
    if (state.matches.has(matchId)) return;
    state.matches.add(matchId);
    this.addToIndex(this.socketsByMatch, matchId, state.socket);
  }

  private routeEnvelope(
    origin: ConnectionState,
    envelope: ServerEventEnvelope,
  ): void {
    const targets = new Set<WebSocket>();
    if (envelope.recipient === "all") {
      if (envelope.matchId) {
        for (const socket of this.socketsByMatch.get(envelope.matchId) ?? []) {
          targets.add(socket);
        }
      } else {
        targets.add(origin.socket);
      }
    } else {
      for (const socket of this.socketsByPlayer.get(
        envelope.recipient.playerId,
      ) ?? []) {
        targets.add(socket);
      }
    }

    const encoded = encodeServerMessage(envelope);
    for (const socket of targets) this.send(socket, encoded);
  }

  private send(socket: WebSocket, encoded: string): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > this.maxBufferedBytes) {
      socket.close(1013, "Client is not consuming messages");
      return;
    }
    socket.send(encoded, (error) => {
      if (error) {
        this.logger.warn("WebSocket delivery failed.", {
          error: error.message,
        });
      }
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatIntervalMs <= 0 || this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const state of this.connections.values()) {
        if (!state.alive) {
          state.socket.terminate();
          continue;
        }
        state.alive = false;
        state.socket.ping();
      }
    }, this.heartbeatIntervalMs);
    this.heartbeat.unref();
  }

  private removeConnection(state: ConnectionState): void {
    if (!this.connections.delete(state.socket)) return;
    this.removeFromIndex(
      this.socketsByPlayer,
      state.principal.playerId,
      state.socket,
    );
    for (const matchId of state.matches) {
      this.removeFromIndex(this.socketsByMatch, matchId, state.socket);
    }
  }

  private addToIndex(
    index: Map<string, Set<WebSocket>>,
    key: string,
    socket: WebSocket,
  ): void {
    const sockets = index.get(key) ?? new Set<WebSocket>();
    sockets.add(socket);
    index.set(key, sockets);
  }

  private removeFromIndex(
    index: Map<string, Set<WebSocket>>,
    key: string,
    socket: WebSocket,
  ): void {
    const sockets = index.get(key);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) index.delete(key);
  }
}

export function createAuthoritativeTransportServer(
  options: TransportServerOptions,
): AuthoritativeTransportServer {
  return new AuthoritativeTransportServer(options);
}
