import type { AppRoute } from "../app/routes";
import { useGameStore } from "../game/state/gameStore";
import { restoreLocalGameActions } from "../online/onlineActionBridge";
import { useOnlineMatchStore } from "../online/onlineStore";
import { GameButton, PageShell } from "../ui/components";
import { useAccount } from "../account/AccountProvider";
import "../styles/home.css";

export function accountActionLabel(state: ReturnType<typeof useAccount>["state"]): string {
  if (state === "signed-in") return "View Account";
  if (state === "checking-session") return "Checking account…";
  if (state === "signing-in") return "Signing in…";
  return "Sign in";
}

export function onlineHomeAction(input: {
  matchId: string | null;
  lifecycle: "active" | "postGame" | null;
  selfPostGamePresence: "present" | "grace" | "absent" | null;
}): "Resume Match" | "Return to post-game room" | "Play Online" {
  if (!input.matchId) return "Play Online";
  if (input.lifecycle === "active") return "Resume Match";
  if (input.lifecycle === "postGame" && input.selfPostGamePresence !== "absent") {
    return "Return to post-game room";
  }
  return "Play Online";
}

interface HomePageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function HomePage({ route, navigate }: HomePageProps) {
  const account = useAccount();
  const hasActiveMatch = useGameStore((state) => state.hasActiveMatch);
  const gamePhase = useGameStore((state) => state.phase.phase);
  const onlineMatchId = useOnlineMatchStore((state) => state.matchId);
  const onlineLifecycle = useOnlineMatchStore((state) => state.lifecycle);
  const selfPostGamePresence = useOnlineMatchStore((state) => state.selfPostGamePresence);
  const disconnectOnline = useOnlineMatchStore((state) => state.disconnect);

  function startLocalMatch() {
    if (onlineMatchId) disconnectOnline(false);
    restoreLocalGameActions();
    navigate("/setup");
  }

  return (
    <PageShell activeRoute={route} navigate={navigate} className="homeShell" variant="home">
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
          <GameButton variant="secondary" size="lg" onClick={() => navigate("/online")}>
            {onlineHomeAction({
              matchId: onlineMatchId,
              lifecycle: onlineLifecycle,
              selfPostGamePresence,
            })}
          </GameButton>
          {hasActiveMatch && !onlineMatchId && gamePhase !== "gameOver" && (
            <GameButton variant="secondary" size="lg" onClick={() => navigate("/game")}>
              Resume Match
            </GameButton>
          )}
          {account.enabled && (
            <GameButton
              variant="ghost"
              size="lg"
              disabled={account.state === "checking-session" || account.state === "signing-in"}
              onClick={() => (account.state === "signed-in" ? navigate("/account") : void account.signIn())}
            >
              {accountActionLabel(account.state)}
            </GameButton>
          )}
        </div>
      </section>
    </PageShell>
  );
}
