import { useEffect } from "react";
import { audioService } from "../audio/audioService";
import { useGameStore } from "../game/state/gameStore";
import { OnlineGameHud } from "../online/OnlineGameHud";
import { useOnlineMatchStore } from "../online/onlineStore";
import { useUiSettings } from "../ui/uiSettings";
import { GamePage } from "../pages/GamePage";
import { HomePage } from "../pages/HomePage";
import { LoadPage } from "../pages/LoadPage";
import { OnlinePage } from "../pages/OnlinePage";
import { RulesPage } from "../pages/RulesPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SetupPage } from "../pages/SetupPage";
import { AccountPage } from "../pages/AccountPage";
import { MatchHistoryReplayPage } from "../pages/MatchHistoryReplayPage";
import { useAppRoute } from "./routes";

export function AppRouter() {
  const [route, navigate] = useAppRoute();
  const hasActiveMatch = useGameStore((state) => state.hasActiveMatch);
  const onlineMatchId = useOnlineMatchStore((state) => state.matchId);
  const onlineLifecycle = useOnlineMatchStore((state) => state.lifecycle);
  const canShowGame = hasActiveMatch || (Boolean(onlineMatchId) && onlineLifecycle === "postGame");
  const reducedMotion = useUiSettings((state) => state.reducedMotion);
  const highContrastBoard = useUiSettings((state) => state.highContrastBoard);
  const soundEnabled = useUiSettings((state) => state.soundEnabled);
  const volume = useUiSettings((state) => state.volume);
  const loadUiSettings = useUiSettings((state) => state.load);

  useEffect(() => {
    loadUiSettings();
  }, [loadUiSettings]);

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? "reduced" : "standard";
    document.documentElement.dataset.boardContrast = highContrastBoard ? "high" : "standard";
  }, [highContrastBoard, reducedMotion]);

  useEffect(() => {
    audioService.setMuted(!soundEnabled);
    audioService.setVolume(volume);
  }, [soundEnabled, volume]);

  useEffect(() => {
    if (route === "/game" && !canShowGame) {
      navigate(onlineMatchId ? "/online" : "/setup", true);
    }
  }, [canShowGame, navigate, onlineMatchId, route]);

  if (route === "/setup") {
    return <SetupPage route={route} navigate={navigate} />;
  }
  if (route === "/online") {
    return <OnlinePage route={route} navigate={navigate} />;
  }
  if (route === "/game" && canShowGame) {
    return (
      <>
        {onlineMatchId && <OnlineGameHud />}
        <GamePage navigate={navigate} />
      </>
    );
  }
  if (route === "/rules") {
    return <RulesPage route={route} navigate={navigate} />;
  }
  if (route === "/load") {
    return <LoadPage route={route} navigate={navigate} />;
  }
  if (route === "/settings") {
    return <SettingsPage route={route} navigate={navigate} />;
  }
  if (route === "/account") {
    return <AccountPage route={route} navigate={navigate} />;
  }
  if (route.startsWith("/account/history/")) {
    return <MatchHistoryReplayPage route={route} navigate={navigate} />;
  }
  return <HomePage route={route} navigate={navigate} />;
}
