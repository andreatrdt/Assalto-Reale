import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  decodeServerMessage,
  encodeClientMessage,
  type ActorIdentity,
  type ClientCommand,
  type ClientCommandEnvelope,
  type ServerEventEnvelope,
} from "@assalto-reale/multiplayer-protocol";

export type OnlineConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface OnlineClientOptions {
  url: string;
  token: string;
  actor: ActorIdentity;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  createWebSocket?: (url: string, protocols?: string | string[]) => WebSocket;
  now?: () => Date;
  createCommandId?: () => string;
  onStateChange?: (state: OnlineConnectionState) => void;
  onEnvelope: (envelope: ServerEventEnvelope) => void;
  onProtocolError?: (message: string) => void;
}

export interface SendCommandOptions {
  matchId?: string | null;
  expectedMatchVersion?: number | null;
}

export class OnlineClient {
  private socket: WebSocket | null = null;
  private state: OnlineConnectionState = "idle";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private lastMatchId: string | null = null;
  private lastMatchVersion: number | null = null;

  constructor(private readonly options: OnlineClientOptions) {}

  connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.closedByUser = false;
    this.open(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
  }

  disconnect(): void {
    this.closedByUser = true;
    this.clearReconnectTimer();
    this.socket?.close(1000, "Client disconnected");
    this.socket = null;
    this.setState("disconnected");
  }

  send(command: ClientCommand, options: SendCommandOptions = {}): string {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Online connection is not open.");
    }

    const commandId = (this.options.createCommandId ?? defaultCommandId)();
    const matchId = options.matchId ?? this.lastMatchId;
    const envelope: ClientCommandEnvelope = {
      protocol: PROTOCOL_NAME,
      protocolVersion: PROTOCOL_VERSION,
      messageType: "command",
      commandId,
      sentAt: (this.options.now ?? (() => new Date()))().toISOString(),
      actor: this.options.actor,
      matchId: matchId ?? null,
      expectedMatchVersion: options.expectedMatchVersion ?? this.lastMatchVersion,
      command,
    };
    this.socket.send(encodeClientMessage(envelope));
    return commandId;
  }

  observeMatch(matchId: string | null, matchVersion: number | null): void {
    this.lastMatchId = matchId;
    this.lastMatchVersion = matchVersion;
  }

  get connectionState(): OnlineConnectionState {
    return this.state;
  }

  private open(nextState: "connecting" | "reconnecting"): void {
    this.setState(nextState);
    const createSocket = this.options.createWebSocket ?? ((url: string, protocols?: string | string[]) => new WebSocket(url, protocols));
    const url = withAccessToken(this.options.url, this.options.token);
    const socket = createSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (socket !== this.socket) return;
      this.reconnectAttempt = 0;
      this.setState("connected");
      if (this.lastMatchId) {
        this.send(
          { type: "RequestSync", lastSeenMatchVersion: this.lastMatchVersion },
          { matchId: this.lastMatchId, expectedMatchVersion: null },
        );
      }
    });

    socket.addEventListener("message", (event) => {
      if (socket !== this.socket || typeof event.data !== "string") return;
      const decoded = decodeServerMessage(event.data);
      if (!decoded.ok) {
        this.options.onProtocolError?.(`${decoded.error.path}: ${decoded.error.message}`);
        return;
      }
      this.lastMatchId = decoded.value.matchId ?? this.lastMatchId;
      this.lastMatchVersion = decoded.value.matchVersion ?? this.lastMatchVersion;
      this.options.onEnvelope(decoded.value);
    });

    socket.addEventListener("close", () => {
      if (socket !== this.socket) return;
      this.socket = null;
      if (this.closedByUser) {
        this.setState("disconnected");
        return;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (socket === this.socket && socket.readyState === WebSocket.OPEN) socket.close();
    });
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.reconnectAttempt += 1;
    this.setState("reconnecting");
    const base = this.options.reconnectDelayMs ?? 500;
    const maximum = this.options.maxReconnectDelayMs ?? 8_000;
    const delay = Math.min(maximum, base * 2 ** Math.max(0, this.reconnectAttempt - 1));
    this.reconnectTimer = setTimeout(() => this.open("reconnecting"), delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setState(state: OnlineConnectionState): void {
    if (state === this.state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }
}

function withAccessToken(rawUrl: string, token: string): string {
  const url = new URL(rawUrl, window.location.href);
  url.searchParams.set("access_token", token);
  return url.toString();
}

function defaultCommandId(): string {
  return `cmd_${crypto.randomUUID().replaceAll("-", "")}`;
}
