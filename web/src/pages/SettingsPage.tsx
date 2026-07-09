import type { AppRoute } from "../app/routes";
import { audioService } from "../audio/audioService";
import { PageHeader, PageShell, Panel, SectionHeader, Toggle } from "../ui/components";
import { useUiSettings } from "../ui/uiSettings";
import "../styles/secondary-pages.css";

interface SettingsPageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function SettingsPage({ route, navigate }: SettingsPageProps) {
  const reducedMotion = useUiSettings((state) => state.reducedMotion);
  const highContrastBoard = useUiSettings((state) => state.highContrastBoard);
  const soundEnabled = useUiSettings((state) => state.soundEnabled);
  const volume = useUiSettings((state) => state.volume);
  const setReducedMotion = useUiSettings((state) => state.setReducedMotion);
  const setHighContrastBoard = useUiSettings((state) => state.setHighContrastBoard);
  const setSoundEnabled = useUiSettings((state) => state.setSoundEnabled);
  const setVolume = useUiSettings((state) => state.setVolume);
  const volumePct = Math.round(volume * 100);

  return (
    <PageShell activeRoute={route} navigate={navigate} className="settingsShell">
      <PageHeader title="Settings" description="Adjust how the game looks and moves on this device." />

      <Panel tone="strong" className="settingsPanel">
        <SectionHeader title="Accessibility" description="Changes apply immediately and are saved in this browser." />
        <div className="settingsStack">
          <Toggle
            label="Reduce motion"
            description="Minimize interface and board transitions."
            checked={reducedMotion}
            onChange={setReducedMotion}
          />
          <Toggle
            label="High contrast board"
            description="Increase contrast between squares, pieces and action markers."
            checked={highContrastBoard}
            onChange={setHighContrastBoard}
          />
        </div>
      </Panel>

      <Panel tone="strong" className="settingsPanel">
        <SectionHeader title="Sound" description="Short audio cues for moves, captures and match events. Saved on this device." />
        <div className="settingsStack">
          <Toggle
            label="Sound effects"
            description="Play subtle sounds during the match."
            checked={soundEnabled}
            onChange={(value) => {
              setSoundEnabled(value);
              if (value) audioService.play("confirm");
            }}
          />
          <div className="volumeField">
            <label htmlFor="volume-slider">
              Volume <span className="volumeValue">{volumePct}%</span>
            </label>
            <input
              id="volume-slider"
              type="range"
              min={0}
              max={100}
              step={5}
              value={volumePct}
              disabled={!soundEnabled}
              aria-valuetext={`${volumePct} percent`}
              onChange={(event) => setVolume(Number(event.currentTarget.value) / 100)}
              onPointerUp={() => soundEnabled && audioService.play("confirm")}
              onKeyUp={() => soundEnabled && audioService.play("confirm")}
            />
          </div>
        </div>
      </Panel>

      <p className="appVersionLine" aria-label={`Application version ${__APP_VERSION__}, build ${__APP_COMMIT__}`}>
        Version {__APP_VERSION__} · {__APP_COMMIT__}
      </p>
    </PageShell>
  );
}
