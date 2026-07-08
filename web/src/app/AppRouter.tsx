import { useEffect } from "react";
import { useGameStore } from "../game/state/gameStore";
import { useUiSettings } from "../ui/uiSettings";
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
  const reducedMotion = useUiSettings((state) => state.reducedMotion);
  const highContrastBoard = useUiSettings((state) => state.highContrastBoard);
  const loadUiSettings = useUiSettings((state) => state.load);

  useEffect(() => {
    loadUiSettings();
  }, [loadUiSettings]);

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? "reduced" : "standard";
    document.documentElement.dataset.boardContrast = highContrastBoard ? "high" : "standard";
  }, [highContrastBoard, reducedMotion]);

  useEffect(() => {
    if (route === "/game" && !hasActiveMatch) {
      navigate("/setup", true);
    }
  }, [hasActiveMatch, navigate, route]);

  if (route === "/setup") return <SetupPage route={route} navigate={navigate} />;
  if (route === "/game" && hasActiveMatch) return <GamePage navigate={navigate} />;
  if (route === "/rules") return <RulesPage route={route} navigate={navigate} />;
  if (route === "/load") return <LoadPage route={route} navigate={navigate} />;
  if (route === "/settings") return <SettingsPage route={route} navigate={navigate} />;
  return <HomePage route={route} navigate={navigate} />;
}
