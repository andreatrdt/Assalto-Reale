import { create } from "zustand";
import type {
  CanonicalMatchSnapshot,
  CommandRejectionCode,
  PlayerSide,
  ServerEventEnvelope,
} from "@assalto-reale/multiplayer-protocol";
import { OnlineClient, type OnlineConnectionState } from "./onlineClient";

export interface OnlineIdentity {
  playerId: string;
  sessionId: string;
  token: string;
}

export interface OnlineRejection {
  commandId: string;
  code: CommandRejectionCode;
  message: string;
}

interface ConnectOptions {
  url: string;
  identity: OnlineIdentity;
}

interface OnlineSessionState {
  connection: OnlineConnectionState;
  client: OnlineClient | null;
  identity: OnlineIdentity | null;
  matchId: string | null;
  matchVersion: number | null;
  inviteCode: string | null;
  assignedSide: PlayerSide | null;
  snapshot: CanonicalMatchSnapshot | null;
  pendingCommandIds: string[];
  lastRejection: OnlineRejection | null;
  connect: (options: ConnectOptions) => void;
  disconnect: () => void;
  hostMatch: () => string;
  joinMatch: (inviteCode: string) => string;
  requestSync: () => string;
  resign: () => string;
  clearRejection: () => void;
  handleEnvelope: (envelope: ServerEventEnvelope) => void;
}

export const useOnlineSession = create<OnlineSessionState>((set, get) => ({
  connection: "idle",
  client: null,
  identity: null,
  matchId: null,
  matchVersion: null,
  inviteCode: null,
  assignedSide: null,
  snapshot: null,
  pendingCommandIds: [],
  lastRejection: null,

  connect: ({ url, identity }) => {
    get().client?.disconnect();
    const client = new OnlineClient({
      url,
      token: identity.token,
      actor: { playerId: identity.playerId, sessionId: identity.sessionId },
      onStateChange: (connection) => set({ connection }),
      onEnvelope: (envelope) => get().handleEnvelope(envelope),
      onProtocolError: (message) =>
        set({
          lastRejection: {
            commandId: "protocol_error",
            code: "invalid_message",
            message,
          },
        }),
    });
    set({
      client,
      identity,
      connection: "connecting",
      lastRejection: null,
    });
    client.connect();
  },

  disconnect: () => {
    get().client?.disconnect();
    set({
      connection: "disconnected",
      client: null,
      identity: null,
      matchId: null,
      matchVersion: null,
      inviteCode: null,
      assignedSide: null,
      snapshot: null,
      pendingCommandIds: [],
      lastRejection: null,
    });
  },

  hostMatch: () => {
    const client = requireClient(get());
    const commandId = client.send({
      type: "CreateMatch",
      config: {
        visibility: "invite",
        placementMode: "Manual",
        transformEnabled: true,
        preferredSide: "Random",
        timeControl: { kind: "untimed" },
      },
    }, { matchId: null, expectedMatchVersion: null });
    set((state) => ({ pendingCommandIds: [...state.pendingCommandIds, commandId] }));
    return commandId;
  },

  joinMatch: (inviteCode) => {
    const client = requireClient(get());
    const commandId = client.send(
      { type: "JoinMatch", inviteCode: inviteCode.trim().toUpperCase() },
      { matchId: null, expectedMatchVersion: null },
    );
    set((state) => ({ pendingCommandIds: [...state.pendingCommandIds, commandId] }));
    return commandId;
  },

  requestSync: () => {
    const state = get();
    const client = requireClient(state);
    if (!state.matchId) throw new Error("No online match is active.");
    const commandId = client.send(
      { type: "RequestSync", lastSeenMatchVersion: state.matchVersion },
      { matchId: state.matchId, expectedMatchVersion: null },
    );
    set((current) => ({ pendingCommandIds: [...current.pendingCommandIds, commandId] }));
    return commandId;
  },

  resign: () => {
    const state = get();
    const client = requireClient(state);
    if (!state.matchId) throw new Error("No online match is active.");
    const commandId = client.send(
      { type: "Resign" },
      { matchId: state.matchId, expectedMatchVersion: state.matchVersion },
    );
    set((current) => ({ pendingCommandIds: [...current.pendingCommandIds, commandId] }));
    return commandId;
  },

  clearRejection: () => set({ lastRejection: null }),

  handleEnvelope: (envelope) => {
    const event = envelope.event;
    set((state) => ({
      matchId: envelope.matchId ?? state.matchId,
      matchVersion: envelope.matchVersion ?? state.matchVersion,
      pendingCommandIds: envelope.causationCommandId
        ? state.pendingCommandIds.filter((id) => id !== envelope.causationCommandId)
        : state.pendingCommandIds,
    }));

    if (event.type === "MatchCreated") {
      get().client?.observeMatch(envelope.matchId, envelope.matchVersion);
      set({
        inviteCode: event.inviteCode,
        assignedSide: event.assignedSide,
        snapshot: event.snapshot,
        lastRejection: null,
      });
      return;
    }

    if (event.type === "PlayerJoined") {
      get().client?.observeMatch(envelope.matchId, envelope.matchVersion);
      set((state) => ({
        assignedSide:
          event.playerId === state.identity?.playerId ? event.assignedSide : state.assignedSide,
        snapshot: event.snapshot,
        lastRejection: null,
      }));
      return;
    }

    if (event.type === "MatchSnapshot" || event.type === "MatchUpdated" || event.type === "MatchEnded") {
      get().client?.observeMatch(envelope.matchId, envelope.matchVersion);
      set({ snapshot: event.snapshot, lastRejection: null });
      return;
    }

    if (event.type === "CommandRejected") {
      if (event.snapshot) set({ snapshot: event.snapshot });
      set({
        lastRejection: {
          commandId: event.commandId,
          code: event.code,
          message: event.message,
        },
      });
    }
  },
}));

function requireClient(state: Pick<OnlineSessionState, "client" | "connection">): OnlineClient {
  if (!state.client || state.connection !== "connected") {
    throw new Error("Online connection is not ready.");
  }
  return state.client;
}
