import type { AppRoute } from "../app/routes";
import { useGameStore } from "../game/state/gameStore";

interface LoadPageProps {
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function LoadPage({ navigate }: LoadPageProps) {
  const loadGame = useGameStore((state) => state.loadGame);
  const hasActiveMatch = useGameStore((state) => state.hasActiveMatch);
  const message = useGameStore((state) => state.message);

  function loadAndContinue() {
    loadGame();
    if (useGameStore.getState().hasActiveMatch) {
      navigate("/game");
    }
  }

  return (
    <main className="menuPage textPage">
      <header className="pageHeader">
        <button type="button" onClick={() => navigate("/")}>
          Home
        </button>
        <div>
          <p className="eyebrow">Saved games</p>
          <h1>Continue</h1>
        </div>
      </header>
      <section className="textPanel">
        <p>{message}</p>
        <div className="panelActions">
          <button type="button" className="primaryAction" onClick={loadAndContinue}>
            Load Local Save
          </button>
          <button type="button" onClick={() => navigate(hasActiveMatch ? "/game" : "/setup")}>
            {hasActiveMatch ? "Current Match" : "New Match"}
          </button>
        </div>
      </section>
    </main>
  );
}
