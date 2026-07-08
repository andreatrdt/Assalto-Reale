import { useEffect } from "react";
import { useGameStore } from "../game/state/gameStore";
import { GamePage } from "../pages/GamePage";
import { HomePage } from "../pages/HomePage";
import { LoadPage } from "../pages/LoadPage";
import { RulesPage } from "../pages/RulesPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SetupPage } from "../pages/SetupPage";
import { useAppRoute } from "./routes";

export function AppRouter() {
  const [route, navigate] = useAppRoute();
  const hasActiveMatch = useGameStore((state) => state.hasActiveMatch);

  useEffect(() => {
    if (route === "/game" && !hasActiveMatch) {
      navigate("/setup", true);
    }
  }, [hasActiveMatch, navigate, route]);

  if (route === "/setup") return <SetupPage navigate={navigate} />;
  if (route === "/game" && hasActiveMatch) return <GamePage navigate={navigate} />;
  if (route === "/rules") return <RulesPage navigate={navigate} />;
  if (route === "/load") return <LoadPage navigate={navigate} />;
  if (route === "/settings") return <SettingsPage navigate={navigate} />;
  return <HomePage navigate={navigate} />;
}
