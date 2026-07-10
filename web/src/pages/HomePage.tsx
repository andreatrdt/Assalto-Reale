import type { AppRoute } from "../app/routes";
import { useGameStore } from "../game/state/gameStore";
import { restoreLocalGameActions } from "../online/onlineActionBridge";
import { useOnlineMatchStore } from "../online/onlineStore";
import { GameButton, PageShell } from "../ui/components";
import "../styles/home.css";

interface HomePageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function HomePage({ route, navigate }: HomePageProps) {
  const hasActiveMatch = useGameStore((state) => state.hasActiveMatch);
  const onlineMatchId = useOnlineMatchStore((state) => state.matchId);
  const disconnectOnline = useOnlineMatchStore((state) => state.disconnect);

  function startLocalMatch() {
    if (onlineMatchId) disconnectOnline(false);
    restoreLocalGameActions();
    navigate("/setup");
  }

  return (
    <PageShell
      activeRoute={route}
      navigate={navigate}
      className="homeShell"
      variant="home"
    >
      <section className="home" aria-labelledby="home-title">
        <div className="homeIdentity">
          <h1 id="home-title" className="homeTitle" aria-label="Assalto Reale">
            <span>Assalto</span>
            <span className="homeTitleAccent">Reale</span>
          </h1>
          <p className="homeMotto">Control. Sacrifice. Conquer.</p>
        </div>

        <div className="homeActions" aria-label="Start actions">
          <GameButton variant="primary" size="lg" onClick={startLocalMatch}>
            Start Match
          </GameButton>
          <GameButton
            variant="secondary"
            size="lg"
            onClick={() => navigate("/online")}
          >
            {onlineMatchId ? "Resume Online Match" : "Play Online"}
          </GameButton>
          {hasActiveMatch && !onlineMatchId && (
            <GameButton
              variant="secondary"
              size="lg"
              onClick={() => navigate("/game")}
            >
              Continue Last Match
            </GameButton>
          )}
        </div>
      </section>
    </PageShell>
  );
}
