import { useMemo, useState } from "react";
import type { AppRoute } from "../app/routes";
import { useOnlineSession } from "../online/onlineSessionStore";
import { FormField, GameButton, PageShell } from "../ui/components";

interface OnlinePageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

const DEFAULT_SERVER_URL = import.meta.env.VITE_ONLINE_WS_URL ?? "ws://localhost:8787/ws";

export function OnlinePage({ route, navigate }: OnlinePageProps) {
  const connection = useOnlineSession((state) => state.connection);
  const inviteCode = useOnlineSession((state) => state.inviteCode);
  const assignedSide = useOnlineSession((state) => state.assignedSide);
  const matchId = useOnlineSession((state) => state.matchId);
  const rejection = useOnlineSession((state) => state.lastRejection);
  const connect = useOnlineSession((state) => state.connect);
  const disconnect = useOnlineSession((state) => state.disconnect);
  const hostMatch = useOnlineSession((state) => state.hostMatch);
  const joinMatch = useOnlineSession((state) => state.joinMatch);
  const clearRejection = useOnlineSession((state) => state.clearRejection);

  const identity = useMemo(createBrowserIdentity, []);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [token, setToken] = useState(() => window.sessionStorage.getItem("assalto:online-token") ?? "");
  const [joinCode, setJoinCode] = useState("");
  const connected = connection === "connected";

  function connectNow() {
    const trimmedToken = token.trim();
    if (!trimmedToken) return;
    window.sessionStorage.setItem("assalto:online-token", trimmedToken);
    clearRejection();
    connect({
      url: serverUrl.trim(),
      identity: { ...identity, token: trimmedToken },
    });
  }

  function host() {
    clearRejection();
    hostMatch();
  }

  function join() {
    const normalized = joinCode.trim().toUpperCase();
    if (!normalized) return;
    clearRejection();
    joinMatch(normalized);
  }

  return (
    <PageShell activeRoute={route} navigate={navigate} className="setupShell">
      <section className="setupForm onlineSetup" aria-labelledby="online-title">
        <div>
          <p className="setupFixedRules">Invite-only · Untimed · Server authoritative</p>
          <h1 id="online-title" className="setupTitle">
            Online Match
          </h1>
        </div>

        {!connected ? (
          <>
            <FormField label="Server">
              <input
                className="textInput"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                spellCheck={false}
                autoComplete="url"
              />
            </FormField>
            <FormField label="Access token">
              <input
                className="textInput"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="current-password"
              />
            </FormField>
            <p className="setupFixedRules" role="status">
              {connectionLabel(connection)}
            </p>
            <GameButton variant="primary" onClick={connectNow} disabled={!token.trim() || connection === "connecting" || connection === "reconnecting"}>
              {connection === "connecting" || connection === "reconnecting" ? "Connecting…" : "Connect"}
            </GameButton>
          </>
        ) : (
          <>
            <div className="onlineStatusCard" role="status">
              <strong>Connected</strong>
              <span>Player {identity.playerId.slice(-8)}</span>
              {assignedSide && <span>You play {assignedSide}</span>}
            </div>

            {inviteCode ? (
              <div className="onlineInviteCard">
                <span>Invite code</span>
                <strong>{inviteCode}</strong>
                <p>Share this code with your opponent. The match starts when they join.</p>
              </div>
            ) : matchId ? (
              <div className="onlineInviteCard">
                <strong>Match connected</strong>
                <p>The canonical game session is ready.</p>
              </div>
            ) : (
              <div className="onlineActions">
                <GameButton variant="primary" onClick={host}>
                  Host Match
                </GameButton>
                <div className="onlineJoinRow">
                  <input
                    className="textInput"
                    aria-label="Invite code"
                    placeholder="Invite code"
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value)}
                    autoCapitalize="characters"
                    maxLength={16}
                  />
                  <GameButton variant="secondary" onClick={join} disabled={!joinCode.trim()}>
                    Join
                  </GameButton>
                </div>
              </div>
            )}

            <GameButton variant="ghost" onClick={disconnect}>
              Disconnect
            </GameButton>
          </>
        )}

        {rejection && (
          <div className="onlineError" role="alert">
            <strong>{rejection.code.replaceAll("_", " ")}</strong>
            <span>{rejection.message}</span>
          </div>
        )}

        <div className="setupFooter">
          <GameButton variant="ghost" onClick={() => navigate("/")}>
            Back
          </GameButton>
        </div>
      </section>
    </PageShell>
  );
}

function createBrowserIdentity(): { playerId: string; sessionId: string } {
  const existingPlayer = window.localStorage.getItem("assalto:online-player-id");
  const playerId = existingPlayer ?? `player_${crypto.randomUUID().replaceAll("-", "")}`;
  if (!existingPlayer) window.localStorage.setItem("assalto:online-player-id", playerId);
  return {
    playerId,
    sessionId: `session_${crypto.randomUUID().replaceAll("-", "")}`,
  };
}

function connectionLabel(connection: ReturnType<typeof useOnlineSession.getState>["connection"]): string {
  if (connection === "connecting") return "Connecting to the authoritative server…";
  if (connection === "reconnecting") return "Connection interrupted. Reconnecting…";
  if (connection === "disconnected") return "Disconnected.";
  return "Enter a server URL and access token to begin.";
}
