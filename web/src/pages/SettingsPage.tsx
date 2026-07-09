import type { AppRoute } from "../app/routes";
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
  const setReducedMotion = useUiSettings((state) => state.setReducedMotion);
  const setHighContrastBoard = useUiSettings((state) => state.setHighContrastBoard);

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

      <p className="appVersionLine" aria-label={`Application version ${__APP_VERSION__}, build ${__APP_COMMIT__}`}>
        Version {__APP_VERSION__} · {__APP_COMMIT__}
      </p>
    </PageShell>
  );
}
