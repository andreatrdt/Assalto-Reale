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

interface SetupPageProps {
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function SetupPage({ navigate }: SetupPageProps) {
  const startConfiguredMatch = useGameStore((state) => state.startConfiguredMatch);
  const [config, setConfig] = useState<MatchConfig>(DEFAULT_MATCH_CONFIG);

  const summary = useMemo(() => {
    const timer = TIMER_PRESETS.find((preset) => preset.seconds === config.timerSeconds)?.label ?? "12 minutes";
    const opponent = config.opponent === "Computer" ? `${config.aiDifficulty} computer` : "Human";
    const side = config.opponent === "Computer" ? `Human ${config.humanSide}` : "Local seats";
    const placement = config.placementMode === "Manual" ? "Manual placement" : "Quick Balanced placement";
    const transform = config.transformEnabled ? "Transform on" : "Transform off";
    return [opponent, side, timer, placement, transform].join(" / ");
  }, [config]);

  function update<K extends keyof MatchConfig>(key: K, value: MatchConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function startMatch() {
    startConfiguredMatch(config);
    navigate("/game");
  }

  return (
    <main className="menuPage setupPage">
      <header className="pageHeader">
        <button type="button" onClick={() => navigate("/")}>
          Back to Home
        </button>
        <div>
          <p className="eyebrow">New match</p>
          <h1>Configure Battle</h1>
        </div>
      </header>

      <section className="setupGrid" aria-label="Match setup">
        <fieldset className="setupGroup">
          <legend>Timer</legend>
          <SegmentedControl
            options={TIMER_PRESETS.map((preset) => ({ label: preset.label, value: preset.seconds }))}
            value={config.timerSeconds}
            onChange={(value) => update("timerSeconds", value as TimerSeconds)}
          />
        </fieldset>

        <fieldset className="setupGroup">
          <legend>Opponent</legend>
          <SegmentedControl<OpponentMode>
            options={[
              { label: "Human", value: "Human" },
              { label: "Computer", value: "Computer" },
            ]}
            value={config.opponent}
            onChange={(value) => update("opponent", value)}
          />
        </fieldset>

        {config.opponent === "Computer" && (
          <>
            <fieldset className="setupGroup">
              <legend>Human side</legend>
              <SegmentedControl<HumanSideChoice>
                options={[
                  { label: "Black", value: "Black" },
                  { label: "White", value: "White" },
                  { label: "Random", value: "Random" },
                ]}
                value={config.humanSide}
                onChange={(value) => update("humanSide", value)}
              />
            </fieldset>

            <fieldset className="setupGroup">
              <legend>AI difficulty</legend>
              <SegmentedControl<AiDifficulty>
                options={[
                  { label: "Easy", value: "Easy" },
                  { label: "Medium", value: "Medium" },
                  { label: "Hard", value: "Hard" },
                ]}
                value={config.aiDifficulty}
                onChange={(value) => update("aiDifficulty", value)}
              />
            </fieldset>
          </>
        )}

        <fieldset className="setupGroup">
          <legend>Placement</legend>
          <SegmentedControl<PlacementMode>
            options={[
              { label: "Manual", value: "Manual" },
              { label: "Quick Balanced", value: "QuickBalanced" },
            ]}
            value={config.placementMode}
            onChange={(value) => update("placementMode", value)}
          />
        </fieldset>

        <fieldset className="setupGroup">
          <legend>Transform</legend>
          <SegmentedControl<boolean>
            options={[
              { label: "Off", value: false },
              { label: "On", value: true },
            ]}
            value={config.transformEnabled}
            onChange={(value) => update("transformEnabled", value)}
          />
        </fieldset>
      </section>

      <aside className="setupSummary" aria-label="Match summary">
        <p className="eyebrow">Match summary</p>
        <p>{summary}</p>
        <button type="button" className="primaryAction" onClick={startMatch}>
          Start Match
        </button>
      </aside>
    </main>
  );
}

interface SegmentedControlProps<T extends string | number | boolean> {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}

function SegmentedControl<T extends string | number | boolean>({ options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div className="segmentedControl">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={Object.is(option.value, value) ? "isSelected" : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
