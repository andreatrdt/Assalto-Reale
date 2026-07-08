import { motion } from "motion/react";
import { useGameStore } from "../game/state/gameStore";
import type { AppRoute } from "../app/routes";

interface HomePageProps {
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function HomePage({ navigate }: HomePageProps) {
  const hasActiveMatch = useGameStore((state) => state.hasActiveMatch);

  return (
    <main className="menuPage homePage">
      <section className="homeHero" aria-labelledby="home-title">
        <motion.div
          className="wordmark"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="crest" aria-hidden="true" />
          <div className="titleBlock">
            <p className="eyebrow">Royal tactical war room</p>
            <h1 id="home-title">Assalto Reale</h1>
          </div>
        </motion.div>
        <p className="heroCopy">A modern command table for the canonical Python ruleset.</p>
        <div className="homeActions" aria-label="Home actions">
          <button type="button" className="primaryAction" onClick={() => navigate("/setup")}>
            New Game
          </button>
          {hasActiveMatch && (
            <button type="button" onClick={() => navigate("/game")}>
              Continue Game
            </button>
          )}
          <button type="button" onClick={() => navigate("/rules")}>
            Rules
          </button>
          <button type="button" onClick={() => navigate("/settings")}>
            Settings
          </button>
        </div>
      </section>

      <section className="homePreview" aria-label="Decorative board preview">
        <div className="previewBoard" aria-hidden="true">
          {Array.from({ length: 64 }, (_, index) => (
            <span key={index} className={index % 9 === 0 || index % 7 === 0 ? "previewEmphasis" : undefined} />
          ))}
        </div>
        <p className="buildInfo">Credits: designed and developed for the Assalto Reale web migration.</p>
      </section>
    </main>
  );
}
