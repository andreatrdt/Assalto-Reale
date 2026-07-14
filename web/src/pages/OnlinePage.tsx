import { useEffect, useRef, useState } from "react";
import type { AppRoute } from "../app/routes";
import { useGameStore } from "../game/state/gameStore";
import { configuredWebSocketUrl } from "../online/onlineIdentity";
import { useOnlineMatchStore } from "../online/onlineStore";
import { FormField, GameButton, PageShell, StatusBadge } from "../ui/components";
import "../styles/online.css";

interface OnlinePageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

/**
 * Return to the canonical board only when a match has actually been hydrated
 * (its snapshot applied → `hasActiveMatch`) and it is not still waiting for an
 * opponent. A connected socket alone is not enough. Placement and playing
 * matches both reopen the same `/game` board, which renders the correct phase.
 */
export function shouldReopenBoard(input: {
  matchId: string | null;
  hasActiveMatch: boolean;
  waitingForOpponent: boolean;
  lifecycle?: "active" | "postGame" | null;
}): boolean {
  return Boolean(input.matchId) && (input.hasActiveMatch || input.lifecycle === "postGame") && !input.waitingForOpponent;
}

export function OnlinePage({ route, navigate }: OnlinePageProps) {
  const [inviteInput, setInviteInput] = useState("");
  const [copied, setCopied] = useState(false);
  const hasActiveMatch = useGameStore((state) => state.hasActiveMatch);
  const connectionStatus = useOnlineMatchStore((state) => state.connectionStatus);
  const connectionDetail = useOnlineMatchStore((state) => state.connectionDetail);
  const syncStatus = useOnlineMatchStore((state) => state.syncStatus);
  const matchId = useOnlineMatchStore((state) => state.matchId);
  const lifecycle = useOnlineMatchStore((state) => state.lifecycle);
  const inviteCode = useOnlineMatchStore((state) => state.inviteCode);
  const side = useOnlineMatchStore((state) => state.side);
  const waitingForOpponent = useOnlineMatchStore((state) => state.waitingForOpponent);
  const pendingCommandId = useOnlineMatchStore((state) => state.pendingCommandId);
  const pendingLifecycle = useOnlineMatchStore((state) => state.pendingLifecycle);
  const lastError = useOnlineMatchStore((state) => state.lastError);
  const hostMatch = useOnlineMatchStore((state) => state.hostMatch);
  const joinMatch = useOnlineMatchStore((state) => state.joinMatch);
  const resumeMatch = useOnlineMatchStore((state) => state.resumeMatch);
  const recoverPendingLifecycle = useOnlineMatchStore((state) => state.recoverPendingLifecycle);
  const startNewMatch = useOnlineMatchStore((state) => state.startNewMatch);
  const disconnect = useOnlineMatchStore((state) => state.disconnect);
  const leavePostGame = useOnlineMatchStore((state) => state.leavePostGame);
  const clearError = useOnlineMatchStore((state) => state.clearError);
  const configured = Boolean(configuredWebSocketUrl());
  const autoResumeStarted = useRef(false);
  const autoRecoverStarted = useRef(false);
  const sessionExpired = connectionStatus === "expired";
  // A persisted intent present on first render means this page load is *recovering*
  // a lost create/join, not starting a fresh one — used only for user-facing copy.
  const recoveringExisting = useRef(useOnlineMatchStore.getState().pendingLifecycle !== "none").current;

  // Navigate to the board only once canonical state is actually hydrated, not
  // merely because the socket is connected.
  useEffect(() => {
    if (
      shouldReopenBoard({
        matchId,
        hasActiveMatch,
        waitingForOpponent,
        lifecycle,
      })
    ) {
      navigate("/game", true);
    }
  }, [hasActiveMatch, lifecycle, matchId, navigate, waitingForOpponent]);

  // On refresh, automatically reconnect and request the canonical snapshot when a
  // match is persisted. Runs once; the button remains as a fallback on failure.
  useEffect(() => {
    if (autoResumeStarted.current) return;
    if (!configured || !matchId) return;
    if (syncStatus !== "idle") return;
    if (connectionStatus === "connected" || connectionStatus === "connecting" || connectionStatus === "reconnecting") return;
    autoResumeStarted.current = true;
    void resumeMatch();
  }, [configured, matchId, syncStatus, connectionStatus, resumeMatch]);

  // On refresh with a create/join whose response was lost (persisted intent but
  // no matchId yet), reconnect once and replay the same command so the server
  // returns the original authoritative result. The button remains as a fallback.
  useEffect(() => {
    if (autoRecoverStarted.current) return;
    if (!configured || matchId || pendingLifecycle === "none") return;
    if (connectionStatus === "connected" || connectionStatus === "connecting" || connectionStatus === "reconnecting") return;
    if (sessionExpired) return;
    autoRecoverStarted.current = true;
    void recoverPendingLifecycle();
  }, [configured, matchId, pendingLifecycle, connectionStatus, sessionExpired, recoverPendingLifecycle]);

  async function copyInvite() {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  async function abandonMatch() {
    if (lifecycle === "postGame" && connectionStatus === "connected") {
      if (!(await leavePostGame())) return;
      if (useOnlineMatchStore.getState().lifecycle === "active") return;
    }
    disconnect(false);
    setInviteInput("");
    clearError();
  }

  const synchronizing = syncStatus === "connecting" || syncStatus === "synchronizing";
  // A create/join whose authoritative result has not yet arrived. While it is in
  // flight the host/join buttons stay disabled so a second match can't be started.
  const recovering = pendingLifecycle !== "none";
  const busy =
    connectionStatus === "connecting" || connectionStatus === "reconnecting" || synchronizing || recovering || Boolean(pendingCommandId);

  function goHome() {
    startNewMatch();
    navigate("/");
  }

  return (
    <PageShell activeRoute={route} navigate={navigate} className="onlineShell">
      <section className="onlinePage" aria-labelledby="online-title">
        <header className="onlineHeader">
          <p className="eyebrow">Invite multiplayer</p>
          <h1 id="online-title">Play Online</h1>
          <p>Create a private match or join a friend. The server owns every move, so both boards stay synchronized.</p>
        </header>

        {!configured && (
          <div className="onlineNotice" role="status">
            <StatusBadge tone="info" icon="warning">
              Server not configured
            </StatusBadge>
            <p>This build has the online interface, but it needs a multiplayer server URL before it can connect.</p>
          </div>
        )}

        {lastError && (
          <div className="onlineError" role="alert">
            <StatusBadge tone="danger" icon="warning">
              Online error
            </StatusBadge>
            <p>{lastError}</p>
            <GameButton variant="ghost" size="sm" onClick={clearError}>
              Dismiss
            </GameButton>
          </div>
        )}

        {sessionExpired ? (
          <div className="onlineNotice panel" role="alert">
            <StatusBadge tone="danger" icon="warning">
              Session expired
            </StatusBadge>
            <h2>Your session has expired</h2>
            <p>This match can no longer be resumed from this browser session. Start a new match to keep playing.</p>
            <div className="onlineActions">
              <GameButton variant="primary" onClick={startNewMatch}>
                Start a new match
              </GameButton>
              <GameButton variant="ghost" onClick={goHome}>
                Return home
              </GameButton>
            </div>
          </div>
        ) : matchId ? (
          <div className="onlineLobby panel">
            <div className="onlineLobbyTop">
              <div>
                <p className="eyebrow">{waitingForOpponent ? "Waiting room" : "Online match"}</p>
                <h2>{waitingForOpponent ? "Invite your opponent" : "Reconnect to your match"}</h2>
              </div>
              <ConnectionBadge status={connectionStatus} detail={connectionDetail} />
            </div>

            {inviteCode && (
              <div className="inviteCodeBlock">
                <span>Invite code</span>
                <strong aria-label={`Invite code ${inviteCode}`}>{inviteCode}</strong>
                <GameButton variant="secondary" size="sm" onClick={() => void copyInvite()}>
                  {copied ? "Copied" : "Copy code"}
                </GameButton>
              </div>
            )}

            <dl className="onlineFacts">
              <div>
                <dt>Your side</dt>
                <dd>{side ?? "Assigning…"}</dd>
              </div>
              <div>
                <dt>Format</dt>
                <dd>Untimed · Manual placement</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{waitingForOpponent ? "Waiting for opponent" : "Ready to resume"}</dd>
              </div>
            </dl>

            <p className="onlineLobbyCopy" aria-live="polite">
              {waitingForOpponent
                ? "Keep this page open. The match will begin automatically when your friend joins."
                : "Reconnect and request the latest canonical board from the server."}
            </p>

            <div className="onlineActions">
              <GameButton variant="primary" disabled={!configured || busy} onClick={() => void resumeMatch()}>
                {synchronizing ? "Synchronizing…" : connectionStatus === "connected" ? "Synchronize Match" : "Reconnect"}
              </GameButton>
              <GameButton variant="ghost" onClick={() => void abandonMatch()}>
                Forget Match
              </GameButton>
            </div>
          </div>
        ) : (
          <div className="onlineChoices">
            {recovering && (
              <div className="onlineNotice" role="status" aria-live="polite">
                <StatusBadge tone="info">
                  {recoveringExisting ? "Recovering" : pendingLifecycle === "create" ? "Creating" : "Joining"}
                </StatusBadge>
                <p>
                  {recoveringExisting
                    ? "Recovering your match…"
                    : pendingLifecycle === "create"
                      ? "Creating your match…"
                      : "Joining the match…"}
                </p>
              </div>
            )}
            <article className="onlineChoice panel">
              <div>
                <p className="eyebrow">Host</p>
                <h2>Create a private match</h2>
                <p>Get a shareable invite code and wait here while your opponent joins.</p>
              </div>
              <ul className="onlineRules">
                <li>Untimed</li>
                <li>Manual placement</li>
                <li>Transform enabled</li>
              </ul>
              <GameButton variant="primary" size="lg" disabled={!configured || busy} onClick={() => void hostMatch()}>
                {busy ? "Connecting…" : "Create Online Match"}
              </GameButton>
            </article>

            <article className="onlineChoice panel">
              <div>
                <p className="eyebrow">Join</p>
                <h2>Enter an invite code</h2>
                <p>Paste the code sent by the host. Your side is assigned by the authoritative server.</p>
              </div>
              <FormField label="Invite code">
                <input
                  aria-label="Invite code"
                  className="onlineCodeInput"
                  value={inviteInput}
                  onChange={(event) => setInviteInput(event.target.value.toUpperCase())}
                  placeholder="INV00001"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={32}
                />
              </FormField>
              <GameButton
                variant="secondary"
                size="lg"
                disabled={!configured || busy || inviteInput.trim().length < 4}
                onClick={() => void joinMatch(inviteInput)}
              >
                {busy ? "Connecting…" : "Join Match"}
              </GameButton>
            </article>
          </div>
        )}

        <GameButton variant="ghost" onClick={() => navigate("/")}>
          Back to Home
        </GameButton>
      </section>
    </PageShell>
  );
}

export function ConnectionBadge({
  status,
  detail,
}: {
  status: ReturnType<typeof useOnlineMatchStore.getState>["connectionStatus"];
  detail?: string | null;
}) {
  const labels = {
    idle: "Not connected",
    connecting: "Connecting",
    connected: "Connected",
    reconnecting: "Reconnecting",
    offline: "Offline",
    error: "Connection error",
    expired: "Session expired",
  } as const;
  const tone =
    status === "connected"
      ? "success"
      : status === "error" || status === "offline" || status === "expired"
        ? "danger"
        : status === "connecting" || status === "reconnecting"
          ? "info"
          : "neutral";
  return (
    <span title={detail ?? undefined}>
      <StatusBadge tone={tone}>{labels[status]}</StatusBadge>
    </span>
  );
}
