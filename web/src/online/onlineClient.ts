import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  decodeServerMessage,
  encodeClientMessage,
  type ClientCommand,
  type ClientCommandEnvelope,
  type ServerEventEnvelope,
} from "./protocol";
import {
  acquireGuestSession,
  authenticatedWebSocketUrl,
  type GuestSessionCredentials,
} from "./onlineIdentity";

export type OnlineConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "error";

export interface OnlineClientCallbacks {
  onStatus(status: OnlineConnectionStatus, detail?: string): void;
  onEnvelope(envelope: ServerEventEnvelope): void;
}

export interface OnlineClientOptions extends OnlineClientCallbacks {
  websocketUrl: string;
  acquireSession?: (websocketUrl: string) => Promise<GuestSessionCredentials>;
  createWebSocket?: (url: string) => WebSocket;
  setTimeout?: typeof window.setTimeout;
  clearTimeout?: typeof window.clearTimeout;
}

export interface CommandContext {
  matchId?: string | null;
  expectedMatchVersion?: number | null;
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
  private readonly acquireSession: (
    websocketUrl: string,
  ) => Promise<GuestSessionCredentials>;
  private readonly createWebSocket: (url: string) => WebSocket;
  private readonly schedule: typeof window.setTimeout;
  private readonly cancelSchedule: typeof window.clearTimeout;
  private socket: WebSocket | null = null;
  private credentials: GuestSessionCredentials | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private explicitlyClosed = false;
  private connecting: Promise<GuestSessionCredentials> | null = null;
  private context: MatchContext = { matchId: null, matchVersion: null };

  constructor(private readonly options: OnlineClientOptions) {
    this.acquireSession = options.acquireSession ?? acquireGuestSession;
    this.createWebSocket =
      options.createWebSocket ?? ((url) => new WebSocket(url));
    this.schedule = options.setTimeout ?? window.setTimeout.bind(window);
    this.cancelSchedule = options.clearTimeout ?? window.clearTimeout.bind(window);
  }

  get principal(): Pick<GuestSessionCredentials, "playerId" | "sessionId"> | null {
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

  async connect(): Promise<GuestSessionCredentials> {
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

    const id = commandId();
    const envelope: ClientCommandEnvelope = {
      protocol: PROTOCOL_NAME,
      protocolVersion: PROTOCOL_VERSION,
      messageType: "command",
      commandId: id,
      sentAt: new Date().toISOString(),
      actor: principal,
      matchId:
        context.matchId === undefined ? this.context.matchId : context.matchId,
      expectedMatchVersion:
        context.expectedMatchVersion === undefined
          ? this.context.matchVersion
          : context.expectedMatchVersion,
      command,
    };
    socket.send(encodeClientMessage(envelope));
    return id;
  }

  private async open(reconnecting: boolean): Promise<GuestSessionCredentials> {
    this.options.onStatus(reconnecting ? "reconnecting" : "connecting");
    const credentials =
      this.credentials ?? (await this.acquireSession(this.options.websocketUrl));
    this.credentials = credentials;

    return new Promise<GuestSessionCredentials>((resolve, reject) => {
      const socket = this.createWebSocket(
        authenticatedWebSocketUrl(this.options.websocketUrl, credentials.token),
      );
      this.socket = socket;
      let opened = false;

      socket.addEventListener("open", () => {
        if (this.socket !== socket) return;
        opened = true;
        this.reconnectAttempt = 0;
        this.options.onStatus("connected");
        resolve(credentials);
        if (this.context.matchId) {
          try {
            this.send(
              {
                type: "RequestSync",
                lastSeenMatchVersion: this.context.matchVersion,
              },
              { expectedMatchVersion: null },
            );
          } catch {
            // A close racing the open event will be handled by reconnect.
          }
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
        this.options.onStatus(
          "offline",
          error instanceof Error ? error.message : "Reconnect failed.",
        );
        this.scheduleReconnect();
      });
    }, delay);
  }
}
