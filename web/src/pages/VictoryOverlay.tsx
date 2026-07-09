import { useEffect, useRef, useState } from "react";
import { GameButton, Icon } from "../ui/components";
import { describeOutcome } from "./victoryOutcome";

interface VictoryOverlayProps {
  message: string;
  /** null for human-vs-human; otherwise whether the local human won. */
  humanIsWinner: boolean | null;
  rematch: () => void;
  newMatch: () => void;
  home: () => void;
  saveGame: () => void;
}

/**
 * Restrained, accessible victory moment. Dims the board with a subtle vignette
 * without hiding the final position, announces the outcome to assistive tech,
 * and offers the standard actions. Escape (deliberately) reveals the final board
 * rather than leaving the match.
 */
export function VictoryOverlay({ message, humanIsWinner, rematch, newMatch, home, saveGame }: VictoryOverlayProps) {
  const [dismissed, setDismissed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const outcome = describeOutcome(message);
  const isDefeat = humanIsWinner === false;
  const title = isDefeat ? "Defeat" : "Victory";

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (dismissed) return null;

  return (
    <div className="victoryOverlay" role="presentation">
      <p className="srOnly" role="status" aria-live="assertive">
        {title}. {outcome.sentence}
      </p>
      <div
        ref={dialogRef}
        className={`victoryDialog${isDefeat ? " isDefeat" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="victory-title"
        aria-describedby="victory-desc"
        tabIndex={-1}
      >
        <span className="victoryCrest" aria-hidden="true">
          <Icon name="crown" />
        </span>
        <h2 id="victory-title" className="victoryTitle">
          {title}
        </h2>
        <p id="victory-desc" className="victoryReason">
          {outcome.sentence}
        </p>
        <div className="victoryActions">
          <GameButton variant="primary" onClick={rematch}>
            Rematch
          </GameButton>
          <GameButton variant="primary" icon="play" onClick={newMatch}>
            New Match
          </GameButton>
          <GameButton variant="secondary" icon="save" onClick={saveGame}>
            Save
          </GameButton>
          <GameButton variant="ghost" icon="home" onClick={home}>
            Home
          </GameButton>
        </div>
        <button type="button" className="victoryDismiss" onClick={() => setDismissed(true)}>
          View final board
        </button>
      </div>
    </div>
  );
}
