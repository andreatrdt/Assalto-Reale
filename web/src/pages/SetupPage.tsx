import { useState } from "react";
import type { AppRoute } from "../app/routes";
import { useGameStore } from "../game/state/gameStore";
import {
  DEFAULT_MATCH_CONFIG,
  TIMER_PRESETS,
  createPublicMatchConfig,
  type HumanSideChoice,
  type OpponentMode,
  type TimerSeconds,
} from "../game/setup/matchConfig";
import { FormField, GameButton, PageShell, SegmentedControl } from "../ui/components";

interface SetupPageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function SetupPage({ route, navigate }: SetupPageProps) {
  const startConfiguredMatch = useGameStore((state) => state.startConfiguredMatch);
  const [opponent, setOpponent] = useState<OpponentMode>(DEFAULT_MATCH_CONFIG.opponent);
  const [humanSide, setHumanSide] = useState<HumanSideChoice>(DEFAULT_MATCH_CONFIG.humanSide);
  const [timerSeconds, setTimerSeconds] = useState<TimerSeconds>(DEFAULT_MATCH_CONFIG.timerSeconds);

  function startMatch() {
    startConfiguredMatch(createPublicMatchConfig({ opponent, humanSide, timerSeconds }));
    navigate("/game");
  }

  return (
    <PageShell activeRoute={route} navigate={navigate} className="setupShell">
      <section className="setupForm" aria-labelledby="setup-title">
        <h1 id="setup-title" className="setupTitle">
          Start a Match
        </h1>

        <FormField label="Opponent">
          <SegmentedControl<OpponentMode>
            label="Opponent"
            options={[
              { label: "Human", value: "Human" },
              { label: "Computer", value: "Computer" },
            ]}
            value={opponent}
            onChange={setOpponent}
          />
        </FormField>

        {opponent === "Computer" && (
          <FormField label="You play">
            <SegmentedControl<HumanSideChoice>
              label="You play"
              options={[
                { label: "Black", value: "Black" },
                { label: "White", value: "White" },
                { label: "Random", value: "Random" },
              ]}
              value={humanSide}
              onChange={setHumanSide}
            />
          </FormField>
        )}

        <FormField label="Time">
          <SegmentedControl<TimerSeconds>
            label="Time"
            options={TIMER_PRESETS.map((preset) => ({ label: preset.label, value: preset.seconds }))}
            value={timerSeconds}
            onChange={setTimerSeconds}
          />
        </FormField>

        <p className="setupFixedRules">Manual placement · Transform enabled</p>

        <div className="setupFooter">
          <GameButton variant="ghost" onClick={() => navigate("/")}>
            Back
          </GameButton>
          <GameButton variant="primary" onClick={startMatch}>
            Start Match
          </GameButton>
        </div>
      </section>
    </PageShell>
  );
}
