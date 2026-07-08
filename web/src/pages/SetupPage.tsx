import { useMemo, useState } from "react";
import type { AppRoute } from "../app/routes";
import { useGameStore } from "../game/state/gameStore";
import {
  DEFAULT_MATCH_CONFIG,
  TIMER_PRESETS,
  type AiDifficulty,
  type HumanSideChoice,
  type MatchConfig,
  type OpponentMode,
  type PlacementMode,
  type TimerSeconds,
} from "../game/setup/matchConfig";
import { FactionBadge, FormField, GameButton, PageHeader, PageShell, Panel, SectionHeader, SegmentedControl, StatusBadge } from "../ui/components";

interface SetupPageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function SetupPage({ route, navigate }: SetupPageProps) {
  const startConfiguredMatch = useGameStore((state) => state.startConfiguredMatch);
  const [config, setConfig] = useState<MatchConfig>(DEFAULT_MATCH_CONFIG);

  const summary = useMemo(() => {
    const timer = TIMER_PRESETS.find((preset) => preset.seconds === config.timerSeconds)?.label ?? "12 minutes";
    const opponent = config.opponent === "Computer" ? `${config.aiDifficulty} computer` : "Human opponent";
    const side = config.opponent === "Computer" ? `Human side: ${config.humanSide}` : "Shared local command";
    const placement = config.placementMode === "Manual" ? "Manual deployment" : "Quick Balanced deployment";
    const transform = config.transformEnabled ? "Transform enabled" : "Transform disabled";
    return { timer, opponent, side, placement, transform };
  }, [config]);

  function update<K extends keyof MatchConfig>(key: K, value: MatchConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function startMatch() {
    startConfiguredMatch(config);
    navigate("/game");
  }

  return (
    <PageShell activeRoute={route} navigate={navigate} className="setupShell">
      <PageHeader
        eyebrow="Pre-match council"
        title="Configure Battle"
        description="Choose the opponent, deployment, clocks and optional Transform rule before entering the command table."
        actions={
          <GameButton variant="ghost" icon="home" onClick={() => navigate("/")}>
            Back
          </GameButton>
        }
      />

      <section className="setupCommandTable" aria-label="Match setup">
        <div className="setupGroups">
          <Panel tone="strong" className="setupPanel">
            <SectionHeader eyebrow="Opponent" title="Command Seats" description="Play locally against another human, or give the opposing side to the computer." />
            <FormField label="Opponent">
              <SegmentedControl<OpponentMode>
                label="Opponent"
                options={[
                  { label: "Human", value: "Human", description: "Two local seats", icon: "crown" },
                  { label: "Computer", value: "Computer", description: "AI takes one side", icon: "gear" },
                ]}
                value={config.opponent}
                onChange={(value) => update("opponent", value)}
              />
            </FormField>

            {config.opponent === "Computer" && (
              <div className="setupNested">
                <FormField label="Human faction" helper="Random resolves once at match start and is saved with the match.">
                  <SegmentedControl<HumanSideChoice>
                    label="Human side"
                    options={[
                      { label: "Black", value: "Black", description: "First move", icon: "crown" },
                      { label: "White", value: "White", description: "Second seat", icon: "shield" },
                      { label: "Random", value: "Random", description: "Resolve on start", icon: "spark" },
                    ]}
                    value={config.humanSide}
                    onChange={(value) => update("humanSide", value)}
                  />
                </FormField>

                <FormField label="AI difficulty">
                  <SegmentedControl<AiDifficulty>
                    label="AI difficulty"
                    options={[
                      { label: "Easy", value: "Easy", description: "Fast scout", icon: "chevron" },
                      { label: "Medium", value: "Medium", description: "Balanced search", icon: "shield" },
                      { label: "Hard", value: "Hard", description: "Deeper plan", icon: "sword" },
                    ]}
                    value={config.aiDifficulty}
                    onChange={(value) => update("aiDifficulty", value)}
                  />
                </FormField>
              </div>
            )}
          </Panel>

          <Panel tone="strong" className="setupPanel">
            <SectionHeader eyebrow="Rules" title="Match Conditions" description="These options can be combined independently." />
            <FormField label="Timer">
              <SegmentedControl<TimerSeconds>
                label="Timer"
                options={TIMER_PRESETS.map((preset) => ({ label: preset.label, value: preset.seconds, icon: "clock" }))}
                value={config.timerSeconds}
                onChange={(value) => update("timerSeconds", value)}
              />
            </FormField>

            <FormField label="Placement" helper="Manual follows the canonical snake-order deployment schedule.">
              <SegmentedControl<PlacementMode>
                label="Placement"
                options={[
                  { label: "Manual", value: "Manual", description: "Place every piece", icon: "board" },
                  { label: "Quick Balanced", value: "QuickBalanced", description: "Auto deploy", icon: "spark" },
                ]}
                value={config.placementMode}
                onChange={(value) => update("placementMode", value)}
              />
            </FormField>

            <FormField label="Transform variant" helper="Optional rule from the Python version. Disabled by default.">
              <SegmentedControl<boolean>
                label="Transform"
                options={[
                  { label: "Off", value: false, description: "Canonical default", icon: "shield" },
                  { label: "On", value: true, description: "Transform Square", icon: "spark" },
                ]}
                value={config.transformEnabled}
                onChange={(value) => update("transformEnabled", value)}
              />
            </FormField>
          </Panel>
        </div>

        <Panel as="aside" tone="strong" className="matchSummaryPanel" aria-label="Match summary">
          <SectionHeader eyebrow="Summary" title="Ready Room" />
          <div className="factionPreview">
            <FactionBadge player="Black" active={config.opponent === "Human" || config.humanSide === "Black"} />
            <span aria-hidden="true">vs</span>
            <FactionBadge player="White" active={config.opponent === "Human" || config.humanSide === "White"} />
          </div>
          <dl className="summaryList">
            <div>
              <dt>Opponent</dt>
              <dd>{summary.opponent}</dd>
            </div>
            <div>
              <dt>Human side</dt>
              <dd>{summary.side}</dd>
            </div>
            <div>
              <dt>Clock</dt>
              <dd>{summary.timer}</dd>
            </div>
            <div>
              <dt>Deployment</dt>
              <dd>{summary.placement}</dd>
            </div>
            <div>
              <dt>Variant</dt>
              <dd>{summary.transform}</dd>
            </div>
          </dl>
          <StatusBadge tone="info" icon="warning">
            Timers are configured now; live countdown parity remains tracked.
          </StatusBadge>
          <GameButton variant="primary" size="lg" icon="play" onClick={startMatch}>
            Start Match
          </GameButton>
        </Panel>
      </section>
    </PageShell>
  );
}
