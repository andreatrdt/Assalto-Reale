import { create } from "zustand";
import type { Action, PawnType, Player, Vec2 } from "../game/engine";
import { useGameStore } from "../game/state/gameStore";
import type { ResolvedDefendedKing } from "../game/state/storeTypes";
import { OnlineClient, type OnlineConnectionStatus } from "./onlineClient";
import { configuredWebSocketUrl } from "./onlineIdentity";
import { clearPendingIntent, loadPendingIntent, newCommandId, savePendingIntent, type PendingLifecycleIntent } from "./onlineIntent";
import { applyOnlineSnapshot, clearOnlineProjection } from "./onlineProjection";
import type {
  ClientCommand,
  CommandRejectionCode,
  JsonObject,
  PostGamePresenceStatus,
  PostGameSnapshot,
  ServerEventEnvelope,
  DeflectionRouteId,
} from "./protocol";

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
  lifecycle: "active" | "postGame" | null;
  selfPostGamePresence: PostGamePresenceStatus | null;
  opponentPostGamePresence: PostGamePresenceStatus | null;
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
  // Whether a create/join is awaiting its authoritative result (drives
  // "Creating…/Joining…/Recovering your match…" copy). "none" once established.
  pendingLifecycle: "none" | "create" | "join";
  lastError: string | null;
  lastRejectionCode: CommandRejectionCode | null;
  winner: Player | null;
  completed: boolean;
  lifecycle: "active" | "postGame" | null;
  selfPostGamePresence: PostGamePresenceStatus | null;
  opponentPostGamePresence: PostGamePresenceStatus | null;
}

export interface OnlineMatchActions {
  connect: () => Promise<boolean>;
  hostMatch: () => Promise<boolean>;
  joinMatch: (inviteCode: string) => Promise<boolean>;
  resumeMatch: () => Promise<boolean>;
  resumeAccountMatch: (matchId: string, side: Player) => Promise<boolean>;
  recoverPendingLifecycle: () => Promise<boolean>;
  startNewMatch: () => void;
  offerRematch: () => boolean;
  respondToRematch: (accept: boolean) => boolean;
  leavePostGame: () => Promise<boolean>;
  sendPlacement: (position: Vec2) => boolean;
  sendAction: (start: Vec2, end: Vec2, routeId?: DeflectionRouteId) => boolean;
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
      lifecycle: value.lifecycle === "active" || value.lifecycle === "postGame" ? value.lifecycle : null,
      selfPostGamePresence:
        value.selfPostGamePresence === "present" || value.selfPostGamePresence === "grace" || value.selfPostGamePresence === "absent"
          ? value.selfPostGamePresence
          : null,
      opponentPostGamePresence:
        value.opponentPostGamePresence === "present" ||
        value.opponentPostGamePresence === "grace" ||
        value.opponentPostGamePresence === "absent"
          ? value.opponentPostGamePresence
          : null,
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
      lifecycle: state.lifecycle,
      selfPostGamePresence: state.selfPostGamePresence,
      opponentPostGamePresence: state.opponentPostGamePresence,
    };
    target.setItem(MATCH_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A blocked sessionStorage must not break the active socket session.
  }
}

const persisted = loadPersistedMatch();
// A create/join whose authoritative result we have not yet safely applied. It is
// mutually exclusive with an established match: once `matchId` is known the intent
// is fulfilled and cleared. Persisted so a lost response survives a reconnect.
let pendingIntent: PendingLifecycleIntent | null = loadPendingIntent();
let client: OnlineClient | null = null;
let syncTimeout: ReturnType<typeof setTimeout> | null = null;
let departureWaiter: {
  commandId: string;
  resolve: (left: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
} | null = null;

function settleDeparture(commandId: string | null, left: boolean): void {
  if (!departureWaiter || commandId !== departureWaiter.commandId) return;
  clearTimeout(departureWaiter.timeout);
  departureWaiter.resolve(left);
  departureWaiter = null;
}

function postGameView(
  postGame: PostGameSnapshot | undefined,
  side: Player | null,
): Pick<OnlineMatchState, "selfPostGamePresence" | "opponentPostGamePresence" | "rematchStatus"> {
  if (!postGame || !side) {
    return {
      selfPostGamePresence: "absent",
      opponentPostGamePresence: "absent",
      rematchStatus: "none",
    };
  }
  const opponent = side === "Black" ? "White" : "Black";
  return {
    selfPostGamePresence: postGame.presence[side],
    opponentPostGamePresence: postGame.presence[opponent],
    rematchStatus: postGame.rematchOfferedBy === null ? "none" : postGame.rematchOfferedBy === side ? "sent" : "received",
  };
}

/**
 * Set or clear the pending lifecycle intent across every place it lives: the
 * module cache, sessionStorage, the client's replay slot, and the store's
 * UI-facing `pendingLifecycle` field. Always call this — never mutate the pieces
 * individually — so they cannot drift apart.
 */
function applyIntent(intent: PendingLifecycleIntent | null, set: (patch: Partial<OnlineMatchStore>) => void): void {
  pendingIntent = intent;
  if (intent) savePendingIntent(intent);
  else clearPendingIntent();
  client?.setLifecycleReplay(intent ? { commandId: intent.commandId, command: intent.command } : null);
  set({ pendingLifecycle: intent ? intent.kind : "none" });
}

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
    case "PostGamePresenceChanged":
      if (envelope.event.presence === "absent") {
        return "Opponent left the post-game room.";
      }
      if (envelope.event.presence === "grace") {
        return "Opponent disconnected. Waiting for reconnect.";
      }
      return "Opponent returned to the post-game room.";
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

function resolvedDefendedKing(events: JsonObject[]): ResolvedDefendedKing | null {
  const applied = [...events].reverse().find((event) => event.type === "ActionApplied");
  const action = applied?.action;
  const transition = applied?.transition;
  if (!action || typeof action !== "object" || Array.isArray(action) || !("defendedKing" in action) || !action.defendedKing) return null;
  const transitionEvents =
    transition && typeof transition === "object" && !Array.isArray(transition) && "events" in transition && Array.isArray(transition.events)
      ? transition.events
      : [];
  const defended = transitionEvents.find(
    (event) => event && typeof event === "object" && !Array.isArray(event) && event.kind === "defended_king",
  );
  const data = defended && typeof defended === "object" && !Array.isArray(defended) && "data" in defended ? defended.data : null;
  const defender = data && typeof data === "object" && !Array.isArray(data) && "defender" in data ? data.defender : null;
  return {
    action: action as unknown as Action,
    defenders:
      Array.isArray(defender) && defender.length === 2 && defender.every((value) => typeof value === "number")
        ? [defender as unknown as Vec2]
        : [],
  };
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
      if (connectionStatus === "expired") {
        // A confirmed anonymous-identity expiry: the old match/intent cannot be
        // owned by a new guest identity. Stop recovering and drop the intent so
        // nothing is replayed under a different playerId. The match row remains in
        // storage only so the UI can name it; it is not resumable from here.
        clearSyncTimeout();
        applyIntent(null, set);
        set({ connectionStatus, connectionDetail: detail ?? null, syncStatus: "failed" });
        return;
      }
      set({ connectionStatus, connectionDetail: detail ?? null });
    },
    onEnvelope: (envelope) => handleEnvelope(envelope, set, get),
  });
  const state = get();
  client.setMatchContext(state.matchId, state.matchVersion);
  client.setLifecycleReplay(pendingIntent ? { commandId: pendingIntent.commandId, command: pendingIntent.command } : null);
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
        lifecycle: "active",
        selfPostGamePresence: null,
        opponentPostGamePresence: null,
      } satisfies Partial<OnlineMatchStore>;
      set(next);
      // The create is now authoritatively resolved (first receipt or replay):
      // the intent has done its job and must not be replayed again.
      applyIntent(null, set);
      applyOnlineSnapshot(envelope.event.snapshot, {
        message,
        side: envelope.event.assignedSide,
      });
      break;
    }
    case "PlayerJoined": {
      const joinedSelf = envelope.event.playerId === state.playerId;
      const side = joinedSelf ? envelope.event.assignedSide : state.side;
      set({
        ...base,
        side,
        waitingForOpponent: false,
        lastError: null,
        lastRejectionCode: null,
        lifecycle: "active",
      });
      // Only the joining device carries a join intent; clear it once our own
      // membership is confirmed. The host sees the opponent's PlayerJoined too and
      // must not treat it as its own recovery.
      if (joinedSelf) applyIntent(null, set);
      applyOnlineSnapshot(envelope.event.snapshot, { message, side });
      break;
    }
    case "MatchUpdated":
      set({
        ...base,
        lifecycle: "active",
        selfPostGamePresence: null,
        opponentPostGamePresence: null,
        lastError: null,
        lastRejectionCode: null,
      });
      applyOnlineSnapshot(envelope.event.snapshot, {
        message,
        side: state.side,
        resolvedDefendedKing: resolvedDefendedKing(envelope.event.domainEvents),
      });
      break;
    case "MatchSnapshot": {
      const ended = envelope.event.status === "ended";
      const postGame = ended ? postGameView(envelope.event.postGame, state.side) : null;
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
        completed: ended,
        lifecycle: ended ? "postGame" : "active",
        ...(postGame ?? {
          selfPostGamePresence: null,
          opponentPostGamePresence: null,
          rematchStatus: "none" as const,
        }),
        winner: ended ? state.winner : null,
        lastError: null,
        lastRejectionCode: null,
      });
      applyOnlineSnapshot(envelope.event.snapshot, {
        message,
        side: state.side,
        ...(ended ? { ended: true } : {}),
      });
      if (postGame?.selfPostGamePresence === "absent") {
        settleDeparture(envelope.causationCommandId, true);
      }
      break;
    }
    case "MatchEnded":
      set({
        ...base,
        waitingForOpponent: false,
        winner: envelope.event.winner,
        completed: true,
        lifecycle: "postGame",
        ...postGameView(envelope.event.postGame, state.side),
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
      // A rejection that answers our pending create/join means the intent can
      // never succeed as-is (duplicate_command, invite_invalid, match_full…).
      // Drop it so it is not replayed forever on each reconnect.
      if (pendingIntent && envelope.event.commandId === pendingIntent.commandId) {
        applyIntent(null, set);
      }
      useGameStore.setState({ message });
      if (envelope.event.snapshot) {
        applyOnlineSnapshot(envelope.event.snapshot, {
          message,
          side: state.side,
        });
      }
      settleDeparture(envelope.causationCommandId, false);
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
        lifecycle: "active",
        selfPostGamePresence: null,
        opponentPostGamePresence: null,
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
      settleDeparture(envelope.causationCommandId, true);
      break;
    }
    case "PostGamePresenceChanged": {
      const view = postGameView(envelope.event.postGame, state.side);
      set({
        ...base,
        lifecycle: "postGame",
        completed: true,
        ...view,
        lastError: null,
        lastRejectionCode: null,
      });
      const changedSelf = state.side !== null && envelope.event.side === state.side;
      if (changedSelf && envelope.event.presence === "absent") {
        settleDeparture(envelope.causationCommandId, true);
      } else if (!changedSelf) {
        useGameStore.setState({ message });
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
  if ((get().syncStatus === "connecting" || get().syncStatus === "synchronizing") && get().lifecycle !== null) {
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

  // Send the pending create/join immediately when the socket is *already* open,
  // because the client's open handler (which normally sends it) will not re-fire.
  // Uses the intent's fixed commandId so the server can replay, never duplicate.
  function sendPendingIntentNow(): void {
    if (!pendingIntent || !client?.connected) return;
    client.send(pendingIntent.command, {
      commandId: pendingIntent.commandId,
      matchId: null,
      expectedMatchVersion: null,
    });
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
    pendingLifecycle: pendingIntent?.kind ?? "none",
    lastError: null,
    lastRejectionCode: null,
    winner: null,
    completed: false,
    lifecycle: persisted?.lifecycle ?? null,
    selfPostGamePresence: persisted?.selfPostGamePresence ?? null,
    opponentPostGamePresence: persisted?.opponentPostGamePresence ?? null,

    connect,

    hostMatch: async () => {
      // Refuse to start a second lifecycle command while one is still pending.
      if (pendingIntent || get().matchId) {
        set({ lastError: "A match request is already in progress." });
        return false;
      }
      const command: ClientCommand = {
        type: "CreateMatch",
        config: {
          visibility: "invite",
          placementMode: "Manual",
          transformEnabled: true,
          preferredSide: "Random",
          timeControl: { kind: "untimed" },
        },
      };
      // Persist the intent (id + exact payload) BEFORE any network I/O, so a lost
      // response is recoverable. The client replays it on open with this commandId.
      const commandId = newCommandId();
      applyIntent({ kind: "create", commandId, command, createdAt: Date.now() }, set);
      set({
        pendingCommandId: commandId,
        waitingForOpponent: true,
        lastError: null,
        lastRejectionCode: null,
        completed: false,
        winner: null,
        lifecycle: null,
        selfPostGamePresence: null,
        opponentPostGamePresence: null,
      });
      const alreadyOpen = client?.connected ?? false;
      if (!(await connect())) return false;
      if (alreadyOpen) sendPendingIntentNow();
      return true;
    },

    joinMatch: async (rawInviteCode) => {
      const inviteCode = rawInviteCode.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{4,32}$/.test(inviteCode)) {
        set({ lastError: "Enter a valid invite code." });
        return false;
      }
      if (pendingIntent || get().matchId) {
        set({ lastError: "A match request is already in progress." });
        return false;
      }
      const command: ClientCommand = { type: "JoinMatch", inviteCode };
      const commandId = newCommandId();
      applyIntent({ kind: "join", commandId, command, createdAt: Date.now() }, set);
      set({
        pendingCommandId: commandId,
        inviteCode,
        waitingForOpponent: false,
        lastError: null,
        lastRejectionCode: null,
        completed: false,
        winner: null,
        lifecycle: null,
        selfPostGamePresence: null,
        opponentPostGamePresence: null,
      });
      const alreadyOpen = client?.connected ?? false;
      if (!(await connect())) return false;
      if (alreadyOpen) sendPendingIntentNow();
      return true;
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

    resumeAccountMatch: async (matchId, side) => {
      clearSyncTimeout();
      client?.disconnect();
      client = null;
      applyIntent(null, set);
      clearOnlineProjection();
      set({
        connectionStatus: "idle",
        connectionDetail: null,
        syncStatus: "idle",
        rematchStatus: "none",
        playerId: null,
        sessionId: null,
        matchId,
        inviteCode: null,
        side,
        matchVersion: null,
        streamSequence: null,
        waitingForOpponent: false,
        pendingCommandId: null,
        pendingLifecycle: "none",
        lastError: null,
        lastRejectionCode: null,
        winner: null,
        completed: false,
        lifecycle: null,
        selfPostGamePresence: null,
        opponentPostGamePresence: null,
      });
      persistMatch(get());
      return get().resumeMatch();
    },

    // Called on mount when a create/join intent is persisted but no match is yet
    // established (its response was lost before a refresh/disconnect). Reconnects
    // and lets the client replay the same commandId; the server returns the
    // original authoritative result. Idempotent against duplicate mounts/clicks.
    recoverPendingLifecycle: async () => {
      if (!pendingIntent || get().matchId) return false;
      const status = get().connectionStatus;
      if (status === "connecting" || status === "reconnecting" || status === "connected" || status === "expired") {
        return false;
      }
      const alreadyOpen = client?.connected ?? false;
      if (!(await connect())) return false;
      if (alreadyOpen) sendPendingIntentNow();
      return true;
    },

    // Discard the expired/unrecoverable session entirely so the next create/join
    // acquires a fresh guest identity. Used by the session-expired UI actions.
    startNewMatch: () => {
      clearSyncTimeout();
      client?.disconnect();
      client = null;
      applyIntent(null, set);
      clearOnlineProjection();
      set({
        connectionStatus: "idle",
        connectionDetail: null,
        syncStatus: "idle",
        rematchStatus: "none",
        matchId: null,
        inviteCode: null,
        side: null,
        matchVersion: null,
        streamSequence: null,
        waitingForOpponent: false,
        pendingCommandId: null,
        winner: null,
        completed: false,
        lifecycle: null,
        selfPostGamePresence: null,
        opponentPostGamePresence: null,
        lastError: null,
        lastRejectionCode: null,
      });
      persistMatch({ ...get(), matchId: null });
    },

    offerRematch: () => {
      // Idempotent from the UI's side: while an offer is in flight or received,
      // do not fire another request.
      if (get().rematchStatus === "sent" || get().opponentPostGamePresence === "absent") {
        return false;
      }
      const sent = sendRematch({ type: "OfferRematch" });
      if (sent) {
        set({ rematchStatus: "sent" });
        useGameStore.setState({ message: "Rematch requested. Waiting for your opponent…" });
      }
      return sent;
    },

    respondToRematch: (accept) => {
      if (get().rematchStatus !== "received" || get().opponentPostGamePresence === "absent") {
        return false;
      }
      const sent = sendRematch({ type: "RespondToRematch", accept });
      if (sent && !accept) {
        set({ rematchStatus: "none" });
      }
      return sent;
    },

    leavePostGame: async () => {
      const state = get();
      if (state.lifecycle !== "postGame" || !state.matchId || state.connectionStatus !== "connected" || departureWaiter) {
        return false;
      }
      try {
        const commandId = client?.send({ type: "LeavePostGame" }, { expectedMatchVersion: null });
        if (!commandId) return false;
        return await new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => {
            if (departureWaiter?.commandId === commandId) {
              departureWaiter = null;
              resolve(false);
            }
          }, 5_000);
          departureWaiter = { commandId, resolve, timeout };
        });
      } catch (error) {
        set({
          lastError: error instanceof Error ? error.message : "Could not leave the post-game room.",
        });
        return false;
      }
    },

    sendPlacement: (position) => send({ type: "PlacePiece", position: [position[0], position[1]] }),
    sendAction: (start, end, routeId) => send({ type: "SubmitAction", start: [start[0], start[1]], end: [end[0], end[1]], routeId }),
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
              lifecycle: null,
              selfPostGamePresence: null,
              opponentPostGamePresence: null,
            }),
      });
      if (!preserveMatch) {
        // Forgetting the match also abandons any in-flight create/join intent.
        applyIntent(null, set);
        persistMatch({ ...get(), matchId: null });
        clearOnlineProjection();
      }
    },

    clearError: () => set({ lastError: null, lastRejectionCode: null }),
  };
});
