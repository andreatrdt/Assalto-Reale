import { useEffect, useState } from "react";
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

export function OnlinePage({ route, navigate }: OnlinePageProps) {
  const [inviteInput, setInviteInput] = useState("");
  const [copied, setCopied] = useState(false);
  const hasActiveMatch = useGameStore((state) => state.hasActiveMatch);
  const connectionStatus = useOnlineMatchStore((state) => state.connectionStatus);
  const connectionDetail = useOnlineMatchStore((state) => state.connectionDetail);
  const matchId = useOnlineMatchStore((state) => state.matchId);
  const inviteCode = useOnlineMatchStore((state) => state.inviteCode);
  const side = useOnlineMatchStore((state) => state.side);
  const waitingForOpponent = useOnlineMatchStore((state) => state.waitingForOpponent);
  const pendingCommandId = useOnlineMatchStore((state) => state.pendingCommandId);
  const lastError = useOnlineMatchStore((state) => state.lastError);
  const hostMatch = useOnlineMatchStore((state) => state.hostMatch);
  const joinMatch = useOnlineMatchStore((state) => state.joinMatch);
  const resumeMatch = useOnlineMatchStore((state) => state.resumeMatch);
  const disconnect = useOnlineMatchStore((state) => state.disconnect);
  const clearError = useOnlineMatchStore((state) => state.clearError);
  const configured = Boolean(configuredWebSocketUrl());

  useEffect(() => {
    if (matchId && hasActiveMatch && !waitingForOpponent) {
      navigate("/game", true);
    }
  }, [hasActiveMatch, matchId, navigate, waitingForOpponent]);

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

  function abandonMatch() {
    disconnect(false);
    setInviteInput("");
    clearError();
  }

  const busy = connectionStatus === "connecting" || connectionStatus === "reconnecting" || Boolean(pendingCommandId);

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

        {matchId ? (
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
                <dt>Match</dt>
                <dd>{matchId}</dd>
              </div>
            </dl>

            <p className="onlineLobbyCopy" aria-live="polite">
              {waitingForOpponent
                ? "Keep this page open. The match will begin automatically when your friend joins."
                : "Reconnect and request the latest canonical board from the server."}
            </p>

            <div className="onlineActions">
              <GameButton variant="primary" disabled={!configured || busy} onClick={() => void resumeMatch()}>
                {connectionStatus === "connected" ? "Synchronize Match" : "Reconnect"}
              </GameButton>
              <GameButton variant="ghost" onClick={abandonMatch}>
                Forget Match
              </GameButton>
            </div>
          </div>
        ) : (
          <div className="onlineChoices">
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
  } as const;
  const tone =
    status === "connected"
      ? "success"
      : status === "error" || status === "offline"
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
