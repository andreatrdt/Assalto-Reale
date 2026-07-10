import { create } from "zustand";
import type { PawnType, Player, Vec2 } from "../game/engine";
import { useGameStore } from "../game/state/gameStore";
import { OnlineClient, type OnlineConnectionStatus } from "./onlineClient";
import { configuredWebSocketUrl } from "./onlineIdentity";
import { applyOnlineSnapshot, clearOnlineProjection } from "./onlineProjection";
import type { ClientCommand, CommandRejectionCode, JsonObject, ServerEventEnvelope } from "./protocol";

const MATCH_STORAGE_KEY = "assalto:online-match";

interface PersistedOnlineMatch {
  matchId: string;
  inviteCode: string | null;
  side: Player | null;
  matchVersion: number | null;
  streamSequence: number | null;
  waitingForOpponent: boolean;
}

export interface OnlineMatchState {
  connectionStatus: OnlineConnectionStatus;
  connectionDetail: string | null;
  playerId: string | null;
  sessionId: string | null;
  matchId: string | null;
  inviteCode: string | null;
  side: Player | null;
  matchVersion: number | null;
  streamSequence: number | null;
  waitingForOpponent: boolean;
  pendingCommandId: string | null;
  lastError: string | null;
  lastRejectionCode: CommandRejectionCode | null;
  winner: Player | null;
  completed: boolean;
}

export interface OnlineMatchActions {
  connect: () => Promise<boolean>;
  hostMatch: () => Promise<boolean>;
  joinMatch: (inviteCode: string) => Promise<boolean>;
  resumeMatch: () => Promise<boolean>;
  sendPlacement: (position: Vec2) => boolean;
  sendAction: (start: Vec2, end: Vec2) => boolean;
  chooseDefender: (position: Vec2) => boolean;
  cancelDefendedKing: () => boolean;
  chooseTransform: (newType: PawnType) => boolean;
  passTurn: () => boolean;
  resign: () => boolean;
  disconnect: (preserveMatch?: boolean) => void;
  clearError: () => void;
}

export type OnlineMatchStore = OnlineMatchState & OnlineMatchActions;

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function loadPersistedMatch(): PersistedOnlineMatch | null {
  const target = storage();
  if (!target) return null;
  try {
    const raw = target.getItem(MATCH_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PersistedOnlineMatch>;
    if (typeof value.matchId !== "string" || value.matchId.length === 0) {
      return null;
    }
    return {
      matchId: value.matchId,
      inviteCode: typeof value.inviteCode === "string" ? value.inviteCode : null,
      side: value.side === "Black" || value.side === "White" ? value.side : null,
      matchVersion: typeof value.matchVersion === "number" ? value.matchVersion : null,
      streamSequence: typeof value.streamSequence === "number" ? value.streamSequence : null,
      waitingForOpponent: Boolean(value.waitingForOpponent),
    };
  } catch {
    return null;
  }
}

function persistMatch(state: OnlineMatchState): void {
  const target = storage();
  if (!target) return;
  try {
    if (!state.matchId) {
      target.removeItem(MATCH_STORAGE_KEY);
      return;
    }
    const value: PersistedOnlineMatch = {
      matchId: state.matchId,
      inviteCode: state.inviteCode,
      side: state.side,
      matchVersion: state.matchVersion,
      streamSequence: state.streamSequence,
      waitingForOpponent: state.waitingForOpponent,
    };
    target.setItem(MATCH_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A blocked sessionStorage must not break the active socket session.
  }
}

const persisted = loadPersistedMatch();
let client: OnlineClient | null = null;

function eventMessage(envelope: ServerEventEnvelope): string {
  switch (envelope.event.type) {
    case "MatchCreated":
      return "Online match created. Share the invite code with your opponent.";
    case "PlayerJoined":
      return "Opponent connected. The online match is ready.";
    case "MatchUpdated":
      return describeDomainEvents(envelope.event.domainEvents);
    case "DecisionRequired":
      return envelope.event.decision.kind === "defendedKing"
        ? "Choose a Defense Pawn for Defended King."
        : "Choose the pawn's Transform type.";
    case "TurnChanged":
      return `${envelope.event.currentPlayer} to move.`;
    case "MatchEnded":
      return `${envelope.event.winner} wins by ${envelope.event.reason.replaceAll("_", " ")}.`;
    case "MatchSnapshot":
      return "Online match synchronized.";
    case "CommandRejected":
      return envelope.event.message;
    case "RematchOffered":
      return "Your opponent offered a rematch.";
    case "RematchCreated":
      return "A rematch was created.";
  }
}

function describeDomainEvents(events: JsonObject[]): string {
  const last = events.at(-1);
  const type = last && typeof last.type === "string" ? last.type : null;
  switch (type) {
    case "PiecePlaced":
      return "Placement accepted by the server.";
    case "PieceMoved":
    case "PieceCaptured":
    case "ActionApplied":
      return "Move accepted by the server.";
    case "TurnPassed":
      return "Turn passed.";
    case "PieceTransformed":
      return "Transform accepted by the server.";
    default:
      return "Match updated by the server.";
  }
}

function createClient(
  set: (patch: Partial<OnlineMatchStore> | ((state: OnlineMatchStore) => Partial<OnlineMatchStore>)) => void,
  get: () => OnlineMatchStore,
): OnlineClient | null {
  const websocketUrl = configuredWebSocketUrl();
  if (!websocketUrl) {
    set({
      connectionStatus: "error",
      connectionDetail: "Online play is not configured for this deployment.",
      lastError: "Set VITE_MULTIPLAYER_WS_URL to enable online play.",
    });
    return null;
  }
  if (client) return client;
  client = new OnlineClient({
    websocketUrl,
    onStatus: (connectionStatus, detail) => {
      set({ connectionStatus, connectionDetail: detail ?? null });
    },
    onEnvelope: (envelope) => handleEnvelope(envelope, set, get),
  });
  const state = get();
  client.setMatchContext(state.matchId, state.matchVersion);
  return client;
}

function handleEnvelope(
  envelope: ServerEventEnvelope,
  set: (patch: Partial<OnlineMatchStore> | ((state: OnlineMatchStore) => Partial<OnlineMatchStore>)) => void,
  get: () => OnlineMatchStore,
): void {
  const state = get();
  if (envelope.streamSequence !== null && state.streamSequence !== null && envelope.streamSequence <= state.streamSequence) {
    return;
  }

  const base: Partial<OnlineMatchStore> = {
    pendingCommandId: envelope.causationCommandId === state.pendingCommandId ? null : state.pendingCommandId,
    matchId: envelope.matchId ?? state.matchId,
    matchVersion: envelope.matchVersion ?? state.matchVersion,
    streamSequence: envelope.streamSequence ?? state.streamSequence,
    connectionDetail: null,
  };
  const message = eventMessage(envelope);

  switch (envelope.event.type) {
    case "MatchCreated": {
      const next = {
        ...base,
        matchId: envelope.matchId,
        inviteCode: envelope.event.inviteCode,
        side: envelope.event.assignedSide,
        waitingForOpponent: true,
        lastError: null,
        lastRejectionCode: null,
        winner: null,
        completed: false,
      } satisfies Partial<OnlineMatchStore>;
      set(next);
      applyOnlineSnapshot(envelope.event.snapshot, {
        message,
        side: envelope.event.assignedSide,
      });
      break;
    }
    case "PlayerJoined": {
      const side = envelope.event.playerId === state.playerId ? envelope.event.assignedSide : state.side;
      set({
        ...base,
        side,
        waitingForOpponent: false,
        lastError: null,
        lastRejectionCode: null,
      });
      applyOnlineSnapshot(envelope.event.snapshot, { message, side });
      break;
    }
    case "MatchUpdated":
      set({ ...base, lastError: null, lastRejectionCode: null });
      applyOnlineSnapshot(envelope.event.snapshot, {
        message,
        side: state.side,
      });
      break;
    case "MatchSnapshot":
      set({
        ...base,
        waitingForOpponent: envelope.matchVersion !== null ? envelope.matchVersion < 2 : state.waitingForOpponent,
        lastError: null,
        lastRejectionCode: null,
      });
      applyOnlineSnapshot(envelope.event.snapshot, {
        message,
        side: state.side,
      });
      break;
    case "MatchEnded":
      set({
        ...base,
        waitingForOpponent: false,
        winner: envelope.event.winner,
        completed: true,
        lastError: null,
        lastRejectionCode: null,
      });
      applyOnlineSnapshot(envelope.event.snapshot, {
        message,
        side: state.side,
        ended: true,
      });
      break;
    case "CommandRejected":
      set({
        ...base,
        lastError: envelope.event.message,
        lastRejectionCode: envelope.event.code,
        matchVersion: envelope.event.currentMatchVersion ?? state.matchVersion,
      });
      useGameStore.setState({ message });
      if (envelope.event.snapshot) {
        applyOnlineSnapshot(envelope.event.snapshot, {
          message,
          side: state.side,
        });
      }
      break;
    case "DecisionRequired":
    case "TurnChanged":
    case "RematchOffered":
    case "RematchCreated":
      set(base);
      useGameStore.setState({ message });
      break;
  }

  const latest = get();
  client?.setMatchContext(latest.matchId, latest.matchVersion);
  persistMatch(latest);
}

export const useOnlineMatchStore = create<OnlineMatchStore>((set, get) => {
  function send(command: ClientCommand): boolean {
    const state = get();
    if (!state.matchId || state.connectionStatus !== "connected") {
      set({ lastError: "The online match is not connected." });
      return false;
    }
    if (state.pendingCommandId) {
      set({ lastError: "Wait for the server to confirm the previous action." });
      return false;
    }
    try {
      const id = client?.send(command);
      if (!id) throw new Error("The multiplayer connection is not ready.");
      set({ pendingCommandId: id, lastError: null, lastRejectionCode: null });
      return true;
    } catch (error) {
      set({
        lastError: error instanceof Error ? error.message : "Could not send the command.",
      });
      return false;
    }
  }

  async function connect(): Promise<boolean> {
    const currentClient = createClient(set, get);
    if (!currentClient) return false;
    try {
      const principal = await currentClient.connect();
      set({
        playerId: principal.playerId,
        sessionId: principal.sessionId,
        lastError: null,
      });
      currentClient.setMatchContext(get().matchId, get().matchVersion);
      return true;
    } catch (error) {
      set({
        connectionStatus: "error",
        connectionDetail: null,
        lastError: error instanceof Error ? error.message : "Could not connect to online play.",
      });
      return false;
    }
  }

  return {
    connectionStatus: "idle",
    connectionDetail: null,
    playerId: null,
    sessionId: null,
    matchId: persisted?.matchId ?? null,
    inviteCode: persisted?.inviteCode ?? null,
    side: persisted?.side ?? null,
    matchVersion: persisted?.matchVersion ?? null,
    streamSequence: persisted?.streamSequence ?? null,
    waitingForOpponent: persisted?.waitingForOpponent ?? false,
    pendingCommandId: null,
    lastError: null,
    lastRejectionCode: null,
    winner: null,
    completed: false,

    connect,

    hostMatch: async () => {
      if (!(await connect())) return false;
      try {
        const id = client?.send(
          {
            type: "CreateMatch",
            config: {
              visibility: "invite",
              placementMode: "QuickBalanced",
              transformEnabled: true,
              preferredSide: "Random",
              timeControl: { kind: "untimed" },
            },
          },
          { matchId: null, expectedMatchVersion: null },
        );
        if (!id) throw new Error("The multiplayer connection is not ready.");
        set({
          pendingCommandId: id,
          waitingForOpponent: true,
          lastError: null,
          lastRejectionCode: null,
          completed: false,
          winner: null,
        });
        return true;
      } catch (error) {
        set({
          lastError: error instanceof Error ? error.message : "Could not create the online match.",
        });
        return false;
      }
    },

    joinMatch: async (rawInviteCode) => {
      const inviteCode = rawInviteCode.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{4,32}$/.test(inviteCode)) {
        set({ lastError: "Enter a valid invite code." });
        return false;
      }
      if (!(await connect())) return false;
      try {
        const id = client?.send({ type: "JoinMatch", inviteCode }, { matchId: null, expectedMatchVersion: null });
        if (!id) throw new Error("The multiplayer connection is not ready.");
        set({
          pendingCommandId: id,
          inviteCode,
          waitingForOpponent: false,
          lastError: null,
          lastRejectionCode: null,
          completed: false,
          winner: null,
        });
        return true;
      } catch (error) {
        set({
          lastError: error instanceof Error ? error.message : "Could not join the online match.",
        });
        return false;
      }
    },

    resumeMatch: async () => {
      if (!get().matchId) {
        set({ lastError: "There is no online match to resume." });
        return false;
      }
      const connected = await connect();
      if (connected) {
        useGameStore.setState({ message: "Synchronizing online match…" });
      }
      return connected;
    },

    sendPlacement: (position) => send({ type: "PlacePiece", position: [position[0], position[1]] }),
    sendAction: (start, end) => send({ type: "SubmitAction", start: [start[0], start[1]], end: [end[0], end[1]] }),
    chooseDefender: (position) => send({ type: "ChooseDefender", position: [position[0], position[1]] }),
    cancelDefendedKing: () => send({ type: "CancelDefendedKing" }),
    chooseTransform: (newType) => send({ type: "ChooseTransform", newType }),
    passTurn: () => send({ type: "PassTurn" }),
    resign: () => send({ type: "Resign" }),

    disconnect: (preserveMatch = true) => {
      client?.disconnect();
      client = null;
      set({
        connectionStatus: "idle",
        connectionDetail: null,
        pendingCommandId: null,
        lastError: null,
        ...(preserveMatch
          ? {}
          : {
              matchId: null,
              inviteCode: null,
              side: null,
              matchVersion: null,
              streamSequence: null,
              waitingForOpponent: false,
              winner: null,
              completed: false,
            }),
      });
      if (!preserveMatch) {
        persistMatch({ ...get(), matchId: null });
        clearOnlineProjection();
      }
    },

    clearError: () => set({ lastError: null, lastRejectionCode: null }),
  };
});
