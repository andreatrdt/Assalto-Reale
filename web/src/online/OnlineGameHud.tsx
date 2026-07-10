import { useEffect, useState } from "react";
import { ConfirmDialog, GameButton, StatusBadge } from "../ui/components";
import {
  installOnlineGameActionBridge,
  onlineActionBlockReason,
} from "./onlineActionBridge";
import { useOnlineMatchStore } from "./onlineStore";
import "../styles/onlineGameHud.css";

export function OnlineGameHud() {
  const [confirmResign, setConfirmResign] = useState(false);
  const matchId = useOnlineMatchStore((state) => state.matchId);
  const side = useOnlineMatchStore((state) => state.side);
  const inviteCode = useOnlineMatchStore((state) => state.inviteCode);
  const matchVersion = useOnlineMatchStore((state) => state.matchVersion);
  const connectionStatus = useOnlineMatchStore(
    (state) => state.connectionStatus,
  );
  const connectionDetail = useOnlineMatchStore(
    (state) => state.connectionDetail,
  );
  const pendingCommandId = useOnlineMatchStore(
    (state) => state.pendingCommandId,
  );
  const lastError = useOnlineMatchStore((state) => state.lastError);
  const completed = useOnlineMatchStore((state) => state.completed);
  const resumeMatch = useOnlineMatchStore((state) => state.resumeMatch);
  const resign = useOnlineMatchStore((state) => state.resign);

  useEffect(() => {
    installOnlineGameActionBridge();
  }, []);

  useEffect(() => {
    if (
      matchId &&
      connectionStatus !== "connected" &&
      connectionStatus !== "connecting" &&
      connectionStatus !== "reconnecting"
    ) {
      void resumeMatch();
    }
  }, [connectionStatus, matchId, resumeMatch]);

  if (!matchId) return null;

  const reason = onlineActionBlockReason();
  const tone =
    connectionStatus === "connected"
      ? "success"
      : connectionStatus === "offline" || connectionStatus === "error"
        ? "danger"
        : "info";
  const connectionLabel = {
    idle: "Not connected",
    connecting: "Connecting",
    connected: "Connected",
    reconnecting: "Reconnecting",
    offline: "Offline",
    error: "Connection error",
  }[connectionStatus];

  return (
    <>
      <section className="onlineGameHud" aria-label="Online match status">
        <div className="onlineGameHudPrimary">
          <StatusBadge tone={tone}>{connectionLabel}</StatusBadge>
          <strong>You play {side ?? "…"}</strong>
          <span>v{matchVersion ?? "…"}</span>
          {inviteCode && <span>Invite {inviteCode}</span>}
        </div>
        <div className="onlineGameHudSecondary">
          <span aria-live="polite">
            {lastError ??
              connectionDetail ??
              (pendingCommandId
                ? "Awaiting server confirmation…"
                : reason ?? "Server-authoritative match")}
          </span>
          {!completed && (
            <GameButton
              variant="danger"
              size="sm"
              disabled={Boolean(pendingCommandId)}
              onClick={() => setConfirmResign(true)}
            >
              Resign
            </GameButton>
          )}
        </div>
      </section>

      {confirmResign && (
        <ConfirmDialog
          title="Resign this online match?"
          confirmLabel="Resign Match"
          danger
          onConfirm={() => {
            resign();
            setConfirmResign(false);
          }}
          onCancel={() => setConfirmResign(false)}
        >
          <p>Your opponent will win immediately. This cannot be undone.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
