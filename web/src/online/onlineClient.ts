import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  decodeServerMessage,
  encodeClientMessage,
  type ClientCommand,
  type ClientCommandEnvelope,
  type ServerEventEnvelope,
} from "./protocol";
import { acquireOnlineSession, authenticatedWebSocketUrl, type OnlineSessionCredentials } from "./onlineIdentity";

export type OnlineConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "offline" | "error" | "expired";

export interface OnlineClientCallbacks {
  onStatus(status: OnlineConnectionStatus, detail?: string): void;
  onEnvelope(envelope: ServerEventEnvelope): void;
}

export interface OnlineClientOptions extends OnlineClientCallbacks {
  websocketUrl: string;
  acquireSession?: (websocketUrl: string, matchId: string | null) => Promise<OnlineSessionCredentials>;
  createWebSocket?: (url: string) => WebSocket;
  setTimeout?: typeof window.setTimeout;
  clearTimeout?: typeof window.clearTimeout;
  now?: () => number;
}

export interface CommandContext {
  matchId?: string | null;
  expectedMatchVersion?: number | null;
  /**
   * When provided, the exact commandId is reused instead of generating a new one.
   * Lifecycle recovery relies on this: a create/join command is replayed with the
   * *same* commandId so the server's receipt idempotency returns the original
   * authoritative result rather than creating a second match/membership.
   */
  commandId?: string;
}

/** A create/join command to (re)send with a fixed commandId once a socket opens. */
export interface LifecycleReplay {
  commandId: string;
  command: ClientCommand;
}

interface MatchContext {
  matchId: string | null;
  matchVersion: number | null;
}

function commandId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replaceAll("-", "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `command_${random}`.slice(0, 128);
}

export class OnlineClient {
  private readonly acquireSession: (websocketUrl: string, matchId: string | null) => Promise<OnlineSessionCredentials>;
  private readonly createWebSocket: (url: string) => WebSocket;
  private readonly schedule: typeof window.setTimeout;
  private readonly cancelSchedule: typeof window.clearTimeout;
  private socket: WebSocket | null = null;
  private credentials: OnlineSessionCredentials | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private explicitlyClosed = false;
  private connecting: Promise<OnlineSessionCredentials> | null = null;
  private context: MatchContext = { matchId: null, matchVersion: null };
  private replay: LifecycleReplay | null = null;
  private readonly now: () => number;

  constructor(private readonly options: OnlineClientOptions) {
    this.acquireSession = options.acquireSession ?? acquireOnlineSession;
    this.createWebSocket = options.createWebSocket ?? ((url) => new WebSocket(url));
    this.schedule = options.setTimeout ?? window.setTimeout.bind(window);
    this.cancelSchedule = options.clearTimeout ?? window.clearTimeout.bind(window);
    this.now = options.now ?? Date.now;
  }

  /**
   * Register (or clear) the create/join command to replay once a socket opens
   * while no match is yet established. The same commandId is reused so the server
   * replays the original authoritative result instead of acting twice.
   */
  setLifecycleReplay(replay: LifecycleReplay | null): void {
    this.replay = replay;
  }

  /**
   * True when the cached credentials have a known expiry that has already passed.
   * The WebSocket upgrade rejects an expired token with an HTTP 401 the browser
   * only surfaces as close code 1006, so `expiresAt` is the deterministic signal
   * that separates a confirmed auth failure from a transient outage.
   */
  private credentialsExpired(): boolean {
    if (!this.credentials) return false;
    const expiry = Date.parse(this.credentials.expiresAt);
    return Number.isFinite(expiry) && expiry <= this.now();
  }

  /** A match or a pending create/join whose ownership is bound to this identity. */
  private hasIdentityBoundWork(): boolean {
    return this.context.matchId !== null || this.replay !== null;
  }

  get principal(): Pick<OnlineSessionCredentials, "playerId" | "sessionId"> | null {
    return this.credentials
      ? {
          playerId: this.credentials.playerId,
          sessionId: this.credentials.sessionId,
        }
      : null;
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  setMatchContext(matchId: string | null, matchVersion: number | null): void {
    this.context = { matchId, matchVersion };
  }

  /**
   * Ask the server for the canonical snapshot of the current match. Requires an
   * open socket and a known match context; throws otherwise so callers can
   * surface a failure instead of silently doing nothing.
   */
  requestSync(): string {
    if (!this.context.matchId) {
      throw new Error("There is no online match to synchronize.");
    }
    return this.send({ type: "RequestSync", lastSeenMatchVersion: this.context.matchVersion }, { expectedMatchVersion: null });
  }

  async connect(): Promise<OnlineSessionCredentials> {
    if (this.connected && this.credentials) return this.credentials;
    if (this.connecting) return this.connecting;
    this.explicitlyClosed = false;
    this.connecting = this.open(false).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  disconnect(): void {
    this.explicitlyClosed = true;
    if (this.reconnectTimer !== null) {
      this.cancelSchedule(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "Client closed");
    }
    this.options.onStatus("idle");
  }

  send(command: ClientCommand, context: CommandContext = {}): string {
    const socket = this.socket;
    const principal = this.principal;
    if (!socket || socket.readyState !== WebSocket.OPEN || !principal) {
      throw new Error("The multiplayer connection is not ready.");
    }

    const id = context.commandId ?? commandId();
    const envelope: ClientCommandEnvelope = {
      protocol: PROTOCOL_NAME,
      protocolVersion: PROTOCOL_VERSION,
      messageType: "command",
      commandId: id,
      sentAt: new Date().toISOString(),
      actor: principal,
      matchId: context.matchId === undefined ? this.context.matchId : context.matchId,
      expectedMatchVersion: context.expectedMatchVersion === undefined ? this.context.matchVersion : context.expectedMatchVersion,
      command,
    };
    socket.send(encodeClientMessage(envelope));
    return id;
  }

  private async open(reconnecting: boolean): Promise<OnlineSessionCredentials> {
    // A cached token that has already expired will be rejected by every future
    // upgrade. When it guards identity-bound work (an active match or a pending
    // create/join) we must not silently acquire a *new* guest identity — that
    // identity cannot own the old match. Stop and surface the expiry instead of
    // looping on 1006. With no such work, drop the stale token and start fresh.
    if (this.credentialsExpired()) {
      if (this.credentials?.authKind === "registered") {
        // A registered credential is a short-lived, single-use ticket. Its
        // expiry is not account-session expiry; reconnect obtains a new ticket.
        this.credentials = null;
      } else if (this.hasIdentityBoundWork()) {
        this.explicitlyClosed = true;
        this.options.onStatus("expired", "Your session has expired.");
        throw new Error("The online session has expired.");
      } else {
        this.credentials = null;
      }
    }

    this.options.onStatus(reconnecting ? "reconnecting" : "connecting");
    const credentials =
      this.credentials?.authKind === "registered"
        ? await this.acquireSession(this.options.websocketUrl, this.context.matchId)
        : (this.credentials ?? (await this.acquireSession(this.options.websocketUrl, this.context.matchId)));
    this.credentials = credentials;

    return new Promise<OnlineSessionCredentials>((resolve, reject) => {
      const socket = this.createWebSocket(authenticatedWebSocketUrl(this.options.websocketUrl, credentials.token, credentials.authKind));
      this.socket = socket;
      let opened = false;

      socket.addEventListener("open", () => {
        if (this.socket !== socket) return;
        opened = true;
        this.reconnectAttempt = 0;
        this.options.onStatus("connected");
        resolve(credentials);
        try {
          if (this.context.matchId) {
            // Fresh connections (including automatic reconnects) request the
            // canonical snapshot immediately so the board rehydrates.
            this.requestSync();
          } else if (this.replay) {
            // No match yet: (re)send the create/join with its original commandId.
            // The server either processes it for the first time or replays the
            // stored authoritative result — never creating a second match.
            this.send(this.replay.command, {
              commandId: this.replay.commandId,
              matchId: null,
              expectedMatchVersion: null,
            });
          }
        } catch {
          // A close racing the open event will be handled by reconnect.
        }
      });

      socket.addEventListener("message", (event) => {
        if (this.socket !== socket || typeof event.data !== "string") return;
        const decoded = decodeServerMessage(event.data);
        if (!decoded.ok) {
          this.options.onStatus("error", decoded.error.message);
          return;
        }
        this.options.onEnvelope(decoded.value);
      });

      socket.addEventListener("error", () => {
        if (!opened) {
          reject(new Error("The multiplayer server could not be reached."));
        }
      });

      socket.addEventListener("close", (event) => {
        if (this.socket === socket) this.socket = null;
        if (!opened) {
          reject(
            new Error(
              event.code === 1006
                ? "The multiplayer server rejected or lost the connection."
                : `The multiplayer connection closed (${event.code}).`,
            ),
          );
        }
        if (this.explicitlyClosed) return;
        this.options.onStatus("offline", "Connection lost. Reconnecting…");
        this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.explicitlyClosed || this.reconnectTimer !== null) return;
    const delay = Math.min(8_000, 500 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.schedule(() => {
      this.reconnectTimer = null;
      void this.open(true).catch((error: unknown) => {
        // A confirmed expiry (or explicit close) already reported terminal status
        // and must not be masked by a transient "offline. Reconnecting…".
        if (this.explicitlyClosed) return;
        this.options.onStatus("offline", error instanceof Error ? error.message : "Reconnect failed.");
        this.scheduleReconnect();
      });
    }, delay);
  }
}
