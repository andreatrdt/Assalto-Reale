import { useEffect, useMemo, useState } from "react";
import type { MatchHistoryDetails } from "../online/protocol";
import { useAccount } from "../account/AccountProvider";
import type { AppRoute } from "../app/routes";
import { GameBoard } from "../board/GameBoard";
import { replayHistoricalMatch } from "../game/engine";
import { GameButton, PageHeader, PageShell, Panel, StatusBadge } from "../ui/components";
import "../styles/account.css";

interface MatchHistoryReplayPageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

function commandLabel(type: string): string {
  return type.replace(/([A-Z])/g, " $1").trim();
}

export function MatchHistoryReplayPage({ route, navigate }: MatchHistoryReplayPageProps) {
  const account = useAccount();
  const { loadHistoryMatch, state: accountState } = account;
  const matchId = route.startsWith("/account/history/") ? route.slice("/account/history/".length) : "";
  const [details, setDetails] = useState<MatchHistoryDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    let active = true;
    if (accountState !== "signed-in" || !matchId) return;
    setError(null);
    void loadHistoryMatch(matchId)
      .then((match) => {
        if (active) setDetails(match);
      })
      .catch(() => {
        if (active) setError("This completed match could not be loaded for your account.");
      });
    return () => {
      active = false;
    };
  }, [accountState, loadHistoryMatch, matchId]);

  const replay = useMemo(() => {
    if (!details?.replayAvailable) return null;
    return replayHistoricalMatch({
      rulesVersion: details.rulesVersion,
      replaySchemaVersion: details.replaySchemaVersion,
      seed: details.seed,
      placementMode: details.config.placementMode,
      transformEnabled: details.config.transformEnabled,
      events: details.events,
    });
  }, [details]);

  const frames = replay?.ok ? replay.frames : [];
  const frame = frames[frameIndex] ?? frames[0];
  const replayError = replay && !replay.ok ? replay.message : null;

  return (
    <PageShell activeRoute="/account" navigate={navigate} className="accountShell replayShell">
      <PageHeader eyebrow="Match History" title="Replay" description="A deterministic reconstruction from compact authoritative events." />
      <div className="accountActions">
        <GameButton variant="secondary" onClick={() => navigate("/account")}>
          Back to account
        </GameButton>
      </div>

      {account.state !== "signed-in" ? (
        <Panel>
          <p>Sign in to open private match history.</p>
        </Panel>
      ) : error ? (
        <Panel>
          <p role="alert">{error}</p>
        </Panel>
      ) : !details ? (
        <Panel>
          <p>Loading immutable match record...</p>
        </Panel>
      ) : !details.replayAvailable || replayError || !frame ? (
        <Panel>
          <StatusBadge tone="danger" icon="warning">
            Replay unavailable
          </StatusBadge>
          <p>{replayError ?? "This match predates complete replay capture. Its completed result remains preserved."}</p>
        </Panel>
      ) : (
        <div className="replayLayout">
          <Panel className="replaySummary">
            <StatusBadge tone={details.result === "win" ? "success" : details.result === "loss" ? "danger" : "neutral"} icon="crown">
              {details.result === "win" ? "Victory" : details.result === "loss" ? "Defeat" : "Draw"}
            </StatusBadge>
            <h2>{details.victoryReason.replaceAll("_", " ")}</h2>
            <p>
              {details.turnCount} turns - {details.durationSeconds} seconds - playing {details.viewerSide}
            </p>
            <p>
              {details.statistics[details.viewerSide].capturesMade} captures - {details.statistics[details.viewerSide].piecesLost} pieces
              lost - {details.statistics[details.viewerSide].transformations} transformations
            </p>
            <p className="accountIdentity">Integrity: {details.integrityChecksum.slice(0, 16)}...</p>
          </Panel>
          <div className="replayBoard" aria-label="Historical game board">
            <GameBoard board={frame.state.board} />
          </div>
          <Panel className="replayControls">
            <div>
              <strong>
                Event {frameIndex} of {frames.length - 1}
              </strong>
              <p>{frame.command ? commandLabel(frame.command.type) : "Initial board"}</p>
            </div>
            <input
              aria-label="Replay event"
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              value={frameIndex}
              onChange={(event) => setFrameIndex(Number(event.currentTarget.value))}
            />
            <div className="accountActions">
              <GameButton size="sm" disabled={frameIndex === 0} onClick={() => setFrameIndex((value) => Math.max(0, value - 1))}>
                Previous
              </GameButton>
              <GameButton
                variant="primary"
                size="sm"
                disabled={frameIndex >= frames.length - 1}
                onClick={() => setFrameIndex((value) => Math.min(frames.length - 1, value + 1))}
              >
                Next event
              </GameButton>
            </div>
          </Panel>
        </div>
      )}
    </PageShell>
  );
}
