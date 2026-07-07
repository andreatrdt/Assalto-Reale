import { motion } from "motion/react";
import { GameBoard } from "../board/GameBoard";
import { useGameStore } from "../game/state/gameStore";

export function App() {
  const phase = useGameStore((state) => state.phase.phase);
  const startQuickMatch = useGameStore((state) => state.startQuickMatch);
  const openRules = useGameStore((state) => state.openRules);
  const returnHome = useGameStore((state) => state.returnHome);
  const board = useGameStore((state) => state.board);

  return (
    <main className="appShell">
      <section className="heroPanel" aria-labelledby="title">
        <motion.div
          className="wordmark"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="crest" aria-hidden="true" />
          <div>
            <p className="eyebrow">Royal tactical war room</p>
            <h1 id="title">Assalto Reale</h1>
          </div>
        </motion.div>

        <div className="heroActions" aria-label="Main actions">
          <button type="button" className="primaryAction" onClick={startQuickMatch}>
            New Quick Match
          </button>
          <button type="button" onClick={openRules}>
            Rules
          </button>
          {phase !== "home" && (
            <button type="button" onClick={returnHome}>
              Home
            </button>
          )}
        </div>

        <p className="buildInfo">Modern web migration branch. Python engine remains the parity reference.</p>
      </section>

      <section className="boardStage" aria-label="Board preview">
        <GameBoard board={board} />
      </section>

      <aside className="phasePanel" aria-live="polite">
        <p className="eyebrow">Phase</p>
        <h2>{phase}</h2>
        {phase === "rules" ? (
          <div className="rulesPreview">
            <h3>Core objective</h3>
            <p>Capture the King, or hold a strict majority of Special Squares through the opponent response turn.</p>
            <h3>Reference engine</h3>
            <p>The TypeScript engine is being verified against deterministic fixtures generated from Python.</p>
          </div>
        ) : (
          <p>Select New Quick Match to enter the new React flow. The board shown here is rendered as responsive SVG.</p>
        )}
      </aside>
    </main>
  );
}
