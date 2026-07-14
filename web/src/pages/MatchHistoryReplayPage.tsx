import { useEffect, useMemo, useState } from "react";
import type { MatchHistoryDetails } from "../online/protocol";
import { useAccount } from "../account/AccountProvider";
import type { AppRoute } from "../app/routes";
import { GameBoard } from "../board/GameBoard";
import { replayHistoricalMatch, type HistoricalReplayFrame } from "../game/engine";
import { GameButton, PageHeader, PageShell, Panel, StatusBadge } from "../ui/components";
import "../styles/account.css";

interface MatchHistoryReplayPageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

function commandLabel(type: string): string {
  return type.replace(/([A-Z])/g, " $1").trim();
}

export interface ReplayMilestones {
  placementComplete: number | null;
  firstCapture: number | null;
  transformation: number | null;
  territoryClaim: number | null;
}

function hasTransitionEvent(frame: HistoricalReplayFrame, kind: string): boolean {
  return frame.events.some((event) => event.type === "ActionApplied" && event.transition.events.some((item) => item.kind === kind));
}

export function findReplayMilestones(frames: HistoricalReplayFrame[]): ReplayMilestones {
  const findIndex = (predicate: (frame: HistoricalReplayFrame, index: number) => boolean): number | null => {
    const index = frames.findIndex(predicate);
    return index >= 0 ? index : null;
  };
  return {
    placementComplete: findIndex(
      (frame, index) => index > 0 && frames[index - 1]?.state.phase === "placement" && frame.state.phase !== "placement",
    ),
    firstCapture: findIndex((frame) => hasTransitionEvent(frame, "capture")),
    transformation: findIndex((frame) => hasTransitionEvent(frame, "transform")),
    territoryClaim: findIndex(
      (frame, index) => Boolean(frame.state.board.territoryClaim) && !frames[index - 1]?.state.board.territoryClaim,
    ),
  };
}

export function MatchHistoryReplayPage({ route, navigate }: MatchHistoryReplayPageProps) {
  const account = useAccount();
  const { loadHistoryMatch, state: accountState } = account;
  const matchId = route.startsWith("/account/history/") ? route.slice("/account/history/".length) : "";
  const [details, setDetails] = useState<MatchHistoryDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  useEffect(() => {
    let active = true;
    if (accountState !== "signed-in" || !matchId) return;
    setDetails(null);
    setFrameIndex(0);
    setPlaying(false);
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

  const frames = useMemo(() => (replay?.ok ? replay.frames : []), [replay]);
  const frame = frames[frameIndex] ?? frames[0];
  const replayError = replay && !replay.ok ? replay.message : null;
  const finalFrameIndex = Math.max(0, frames.length - 1);
  const milestones = useMemo(() => findReplayMilestones(frames), [frames]);

  useEffect(() => {
    if (!playing) return;
    if (frameIndex >= finalFrameIndex) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setFrameIndex((value) => Math.min(finalFrameIndex, value + 1));
    }, 1000 / playbackSpeed);
    return () => window.clearTimeout(timer);
  }, [finalFrameIndex, frameIndex, playbackSpeed, playing]);

  function goToFrame(index: number): void {
    setPlaying(false);
    setFrameIndex(Math.max(0, Math.min(finalFrameIndex, index)));
  }

  return (
    <PageShell activeRoute="/account" navigate={navigate} className="accountShell replayShell">
      <PageHeader eyebrow="Match History" title="Replay" description="A deterministic reconstruction from compact authoritative events." />
      <div className="accountActions">
        <GameButton variant="secondary" onClick={() => navigate("/account")}>
          Back to account
        </GameButton>
      </div>

      {account.state === "session-expired" ? (
        <Panel>
          <p role="alert">Your account session expired. Sign in again to load this private replay.</p>
        </Panel>
      ) : account.state !== "signed-in" ? (
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
              onChange={(event) => goToFrame(Number(event.currentTarget.value))}
            />
            <div className="accountActions">
              <GameButton size="sm" disabled={frameIndex === 0} onClick={() => goToFrame(0)}>
                First
              </GameButton>
              <GameButton size="sm" disabled={frameIndex === 0} onClick={() => goToFrame(frameIndex - 1)}>
                Previous
              </GameButton>
              <GameButton variant="primary" size="sm" disabled={frameIndex >= finalFrameIndex} onClick={() => goToFrame(frameIndex + 1)}>
                Next event
              </GameButton>
              <GameButton size="sm" disabled={frameIndex >= finalFrameIndex} onClick={() => goToFrame(finalFrameIndex)}>
                Final
              </GameButton>
              <GameButton
                variant="secondary"
                size="sm"
                disabled={finalFrameIndex === 0 || (!playing && frameIndex >= finalFrameIndex)}
                onClick={() => setPlaying((value) => !value)}
              >
                {playing ? "Pause" : "Play"}
              </GameButton>
              <label>
                Playback speed
                <select
                  aria-label="Playback speed"
                  value={playbackSpeed}
                  onChange={(event) => setPlaybackSpeed(Number(event.currentTarget.value))}
                >
                  <option value={0.5}>0.5x</option>
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                </select>
              </label>
            </div>
            <div className="accountActions" aria-label="Replay milestones">
              <GameButton
                size="sm"
                disabled={milestones.placementComplete === null}
                onClick={() => goToFrame(milestones.placementComplete ?? 0)}
              >
                Placement complete
              </GameButton>
              <GameButton size="sm" disabled={milestones.firstCapture === null} onClick={() => goToFrame(milestones.firstCapture ?? 0)}>
                First capture
              </GameButton>
              <GameButton size="sm" disabled={milestones.transformation === null} onClick={() => goToFrame(milestones.transformation ?? 0)}>
                Transformation
              </GameButton>
              <GameButton size="sm" disabled={milestones.territoryClaim === null} onClick={() => goToFrame(milestones.territoryClaim ?? 0)}>
                Territory claim
              </GameButton>
            </div>
          </Panel>
        </div>
      )}
    </PageShell>
  );
}
