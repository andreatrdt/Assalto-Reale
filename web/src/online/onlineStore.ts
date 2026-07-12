import { create } from "zustand";
import type { PawnType, Player, Vec2 } from "../game/engine";
import { useGameStore } from "../game/state/gameStore";
import { OnlineClient, type OnlineConnectionStatus } from "./onlineClient";
import { configuredWebSocketUrl } from "./onlineIdentity";
import { applyOnlineSnapshot, clearOnlineProjection } from "./onlineProjection";
import type { ClientCommand, CommandRejectionCode, JsonObject, ServerEventEnvelope } from "./protocol";

const MATCH_STORAGE_KEY = "assalto:online-match";

// Explicit reconnect/synchronization lifecycle. "Connected" alone is not enough:
// a match is only usable once its canonical snapshot has been applied.
export type OnlineSyncStatus = "idle" | "connecting" | "synchronizing" | "synchronized" | "failed";

// Rematch negotiation from this client's point of view.
//   none     – no rematch in play
//   sent     – we asked; waiting for the opponent
//   received – the opponent asked; we can accept or decline
//   declined – the opponent declined our request
export type OnlineRematchStatus = "none" | "sent" | "received" | "declined";

// If the server never answers a RequestSync, restore the button so the user can
// retry instead of being stuck on a silent "synchronizing" state.
const SYNC_TIMEOUT_MS = 12_000;
const SYNC_FAILED_MESSAGE = "Could not synchronize the match. Check your connection and try again.";

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
  syncStatus: OnlineSyncStatus;
  rematchStatus: OnlineRematchStatus;
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
  offerRematch: () => boolean;
  respondToRematch: (accept: boolean) => boolean;
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
let syncTimeout: ReturnType<typeof setTimeout> | null = null;

function clearSyncTimeout(): void {
  if (syncTimeout !== null) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }
}

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
      return "Your opponent wants a rematch.";
    case "RematchDeclined":
      return "Your opponent declined the rematch.";
    case "RematchCreated":
      return "Starting the rematch…";
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
  // Match-scoped ordering: ignore any event addressed to a different match than
  // the active one. Only a RematchCreated may introduce a new matchId (the
  // successor); a late event from a previous match must never switch the client
  // back or overwrite the active successor. The initial create/join is allowed
  // because the client has no active match yet (matchId is null).
  if (
    envelope.event.type !== "RematchCreated" &&
    envelope.matchId !== null &&
    state.matchId !== null &&
    envelope.matchId !== state.matchId
  ) {
    return;
  }
  // A MatchSnapshot is a full canonical state (the RequestSync/reconnect
  // response) and must always be applied — even at the same stream position the
  // client already persisted before a refresh. Only incremental events are
  // de-duplicated by stream sequence, scoped to the current match's own stream.
  if (
    envelope.event.type !== "MatchSnapshot" &&
    envelope.matchId === state.matchId &&
    envelope.streamSequence !== null &&
    state.streamSequence !== null &&
    envelope.streamSequence <= state.streamSequence
  ) {
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
        // A canonical snapshot is the authoritative resolution of any in-flight
        // command: after a full sync the client holds the true post-command state
        // whether or not a lost-response command applied, so it must stop waiting.
        // The user acts next from canonical state; we never blindly resend, and
        // server idempotency (commandId receipts) still guards any manual retry.
        pendingCommandId: null,
        // Derive lifecycle from the authoritative status the snapshot carries,
        // never from the match version (a rematch starts at version 1 with both
        // players present, which the old matchVersion < 2 heuristic mis-flagged as
        // still waiting for an opponent).
        waitingForOpponent: envelope.event.status === "awaitingOpponent",
        completed: envelope.event.status === "ended",
        winner: envelope.event.status === "ended" ? state.winner : null,
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
    case "RematchOffered":
      set({ ...base, rematchStatus: "received", lastError: null, lastRejectionCode: null });
      useGameStore.setState({ message });
      break;
    case "RematchDeclined":
      set({ ...base, rematchStatus: "declined", lastError: null, lastRejectionCode: null });
      useGameStore.setState({ message });
      break;
    case "RematchCreated": {
      // Replace the whole online context with the brand-new successor match. No
      // old board, history, result, version or stream is carried over.
      const newMatchId = envelope.event.newMatchId;
      set({
        matchId: newMatchId,
        inviteCode: envelope.event.inviteCode,
        side: envelope.event.assignedSide,
        matchVersion: envelope.matchVersion,
        streamSequence: envelope.streamSequence,
        waitingForOpponent: false,
        completed: false,
        winner: null,
        pendingCommandId: null,
        rematchStatus: "none",
        lastError: null,
        lastRejectionCode: null,
        connectionDetail: null,
      });
      applyOnlineSnapshot(envelope.event.snapshot, {
        message,
        side: envelope.event.assignedSide,
      });
      // Point the socket at the successor and subscribe to its live stream.
      client?.setMatchContext(newMatchId, envelope.matchVersion);
      try {
        client?.requestSync();
      } catch {
        // The next action (or a reconnect) will subscribe and resync.
      }
      break;
    }
    case "DecisionRequired":
    case "TurnChanged":
      set(base);
      useGameStore.setState({ message });
      break;
  }

  // A pending synchronization resolves as soon as canonical state is in hand.
  if ((get().syncStatus === "connecting" || get().syncStatus === "synchronizing") && useGameStore.getState().hasActiveMatch) {
    clearSyncTimeout();
    set({ syncStatus: "synchronized" });
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

  // Rematch negotiation targets the (terminal) match without an expected version
  // and is independent of the gameplay pending-command gate.
  function sendRematch(command: ClientCommand): boolean {
    const state = get();
    if (!state.matchId || state.connectionStatus !== "connected") {
      set({ lastError: "The online match is not connected." });
      return false;
    }
    try {
      const id = client?.send(command, { expectedMatchVersion: null });
      if (!id) throw new Error("The multiplayer connection is not ready.");
      set({ lastError: null, lastRejectionCode: null });
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
    syncStatus: "idle",
    rematchStatus: "none",
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
              placementMode: "Manual",
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
      const current = get();
      if (!current.matchId) {
        set({ lastError: "There is no online match to resume." });
        return false;
      }
      // Ignore duplicate clicks / overlapping auto-reconnects: a synchronization
      // is already in flight.
      if (current.syncStatus === "connecting" || current.syncStatus === "synchronizing") {
        return false;
      }

      clearSyncTimeout();
      set({ syncStatus: "connecting", lastError: null, lastRejectionCode: null });

      // Whether a fresh socket has to be opened decides who sends RequestSync:
      // a fresh open triggers it from the client's open handler; an already-open
      // socket needs it sent explicitly here (the open handler will not re-fire).
      const alreadyOpen = client?.connected ?? false;
      const connected = await connect();
      if (!connected) {
        clearSyncTimeout();
        set({ syncStatus: "failed" });
        return false;
      }
      // A fresh open may have already delivered the snapshot during the await.
      if (get().syncStatus === "synchronized") {
        clearSyncTimeout();
        return true;
      }

      set({ syncStatus: "synchronizing" });
      useGameStore.setState({ message: "Synchronizing online match…" });

      if (alreadyOpen) {
        try {
          client?.requestSync();
        } catch {
          clearSyncTimeout();
          set({ syncStatus: "failed", lastError: SYNC_FAILED_MESSAGE });
          return false;
        }
      }

      // If no canonical snapshot arrives, fail loudly and restore the button.
      clearSyncTimeout();
      syncTimeout = setTimeout(() => {
        syncTimeout = null;
        if (get().syncStatus === "synchronizing" || get().syncStatus === "connecting") {
          set({ syncStatus: "failed", lastError: SYNC_FAILED_MESSAGE });
        }
      }, SYNC_TIMEOUT_MS);

      return true;
    },

    offerRematch: () => {
      // Idempotent from the UI's side: while an offer is in flight or received,
      // do not fire another request.
      if (get().rematchStatus === "sent") return false;
      const sent = sendRematch({ type: "OfferRematch" });
      if (sent) {
        set({ rematchStatus: "sent" });
        useGameStore.setState({ message: "Rematch requested. Waiting for your opponent…" });
      }
      return sent;
    },

    respondToRematch: (accept) => {
      if (get().rematchStatus !== "received") return false;
      const sent = sendRematch({ type: "RespondToRematch", accept });
      if (sent && !accept) {
        set({ rematchStatus: "none" });
      }
      return sent;
    },

    sendPlacement: (position) => send({ type: "PlacePiece", position: [position[0], position[1]] }),
    sendAction: (start, end) => send({ type: "SubmitAction", start: [start[0], start[1]], end: [end[0], end[1]] }),
    chooseDefender: (position) => send({ type: "ChooseDefender", position: [position[0], position[1]] }),
    cancelDefendedKing: () => send({ type: "CancelDefendedKing" }),
    chooseTransform: (newType) => send({ type: "ChooseTransform", newType }),
    passTurn: () => send({ type: "PassTurn" }),
    resign: () => send({ type: "Resign" }),

    disconnect: (preserveMatch = true) => {
      clearSyncTimeout();
      client?.disconnect();
      client = null;
      set({
        connectionStatus: "idle",
        connectionDetail: null,
        syncStatus: "idle",
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
              rematchStatus: "none",
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
