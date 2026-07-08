import type { AppRoute } from "../app/routes";
import { EmptyState, PageHeader, PageShell, Panel, SectionHeader, StatusBadge, Toggle } from "../ui/components";
import { useUiSettings } from "../ui/uiSettings";

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
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Only implemented preferences are shown here. Audio, music and gameplay defaults remain future parity work."
      />

      <div className="settingsGrid">
        <Panel tone="strong">
          <SectionHeader eyebrow="Accessibility" title="Motion And Clarity" description="These preferences apply immediately and are stored in this browser." />
          <div className="settingsStack">
            <Toggle
              label="Reduce motion"
              description="Minimize route, board and status transitions."
              checked={reducedMotion}
              onChange={setReducedMotion}
            />
            <Toggle
              label="High contrast board"
              description="Increase tile, marker and coordinate contrast."
              checked={highContrastBoard}
              onChange={setHighContrastBoard}
            />
          </div>
        </Panel>

        <Panel tone="subtle">
          <SectionHeader eyebrow="Coming later" title="Audio And Defaults" />
          <EmptyState icon="warning" title="Not exposed until implemented">
            <p>Movement sounds, capture sounds, music, and gameplay default presets are tracked in the parity checklist. They are not shown as inactive toggles.</p>
          </EmptyState>
          <StatusBadge tone="info" icon="shield">
            The board remains fully playable with these preferences off.
          </StatusBadge>
        </Panel>
      </div>
    </PageShell>
  );
}
