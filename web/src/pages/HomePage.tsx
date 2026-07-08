import type { AppRoute } from "../app/routes";
import { useGameStore } from "../game/state/gameStore";
import { FactionBadge, GameButton, Icon, PageShell, Panel, StatusBadge } from "../ui/components";

interface HomePageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function HomePage({ route, navigate }: HomePageProps) {
  const hasActiveMatch = useGameStore((state) => state.hasActiveMatch);

  return (
    <PageShell activeRoute={route} navigate={navigate} className="homeShell">
      <section className="homeHero" aria-labelledby="home-title">
        <div className="heroIdentity">
          <span className="heroCrest" aria-hidden="true">
            <Icon name="crown" />
          </span>
          <p className="eyebrow">Medieval abstract strategy</p>
          <h1 id="home-title">Assalto Reale</h1>
          <p className="heroCopy">
            Command Black or White across a royal tactical board where action points, protected Kings, Special Squares and territory claims decide the match.
          </p>
        </div>

        <div className="heroActions" aria-label="Start actions">
          <GameButton variant="primary" size="lg" icon="play" onClick={() => navigate("/setup")}>
            New Match
          </GameButton>
          <GameButton variant="secondary" size="lg" icon={hasActiveMatch ? "board" : "load"} onClick={() => navigate(hasActiveMatch ? "/game" : "/load")}>
            {hasActiveMatch ? "Continue Match" : "Load Match"}
          </GameButton>
        </div>

        <div className="homeQuickLinks">
          <button type="button" onClick={() => navigate("/rules")}>
            Read rules
          </button>
          <button type="button" onClick={() => navigate("/settings")}>
            Preferences
          </button>
        </div>
      </section>

      <aside className="homeTableau" aria-label="Game overview">
        <div className="royalBoardPreview" aria-hidden="true">
          {Array.from({ length: 144 }, (_, index) => {
            const row = Math.floor(index / 12);
            const col = index % 12;
            const isSpecial = (row === 2 && col === 4) || (row === 4 && col === 8) || (row === 7 && col === 3) || (row === 8 && col === 7);
            const hasPiece = (row === 5 && col === 2) || (row === 5 && col === 9) || (row === 3 && col === 1) || (row === 8 && col === 10);
            return <span key={index} className={`${isSpecial ? "previewSpecial" : ""} ${hasPiece ? "previewPiece" : ""}`.trim()} />;
          })}
        </div>
        <Panel tone="subtle" className="homeFacts">
          <StatusBadge tone="gold" icon="board">
            12x12 board
          </StatusBadge>
          <div className="factionRow">
            <FactionBadge player="Black" />
            <FactionBadge player="White" />
          </div>
          <p>Manual deployment is the default. Quick Balanced setup, AI opponent and Transform remain configurable before every match.</p>
        </Panel>
      </aside>
    </PageShell>
  );
}
