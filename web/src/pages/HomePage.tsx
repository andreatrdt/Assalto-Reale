import type { AppRoute } from "../app/routes";
import { useGameStore } from "../game/state/gameStore";
import { GameButton, PageShell } from "../ui/components";

interface HomePageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function HomePage({ route, navigate }: HomePageProps) {
  const hasActiveMatch = useGameStore((state) => state.hasActiveMatch);

  return (
    <PageShell activeRoute={route} navigate={navigate} className="homeShell" variant="home">
      <section className="home" aria-labelledby="home-title">
        <h1 id="home-title" className="homeTitle">
          Assalto Reale
        </h1>

        <div className="homeActions" aria-label="Start actions">
          <GameButton variant="primary" size="lg" onClick={() => navigate("/setup")}>
            Start Match
          </GameButton>
          {hasActiveMatch && (
            <GameButton variant="secondary" size="lg" onClick={() => navigate("/game")}>
              Continue Last Match
            </GameButton>
          )}
        </div>
      </section>
    </PageShell>
  );
}
