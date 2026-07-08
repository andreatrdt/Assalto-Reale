import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { routeFromPathname } from "../app/routes";
import { useGameStore } from "../game/state/gameStore";
import { ConfirmDialog } from "../ui/components";
import { GamePage } from "./GamePage";
import { HomePage } from "./HomePage";
import { LoadPage } from "./LoadPage";
import { RulesPage } from "./RulesPage";
import { SettingsPage } from "./SettingsPage";
import { SetupPage } from "./SetupPage";

const navigate = () => undefined;

describe("route presentation", () => {
  it("normalizes unknown routes to Home", () => {
    expect(routeFromPathname("/missing")).toBe("/");
    expect(routeFromPathname("/setup")).toBe("/setup");
  });

  it("renders the non-game routes with the shared shell", () => {
    const home = renderToStaticMarkup(<HomePage route="/" navigate={navigate} />);
    const rules = renderToStaticMarkup(<RulesPage route="/rules" navigate={navigate} />);
    const load = renderToStaticMarkup(<LoadPage route="/load" navigate={navigate} />);
    const settings = renderToStaticMarkup(<SettingsPage route="/settings" navigate={navigate} />);

    expect(home).toContain("Assalto Reale");
    expect(home).toContain("New Match");
    expect(rules).toContain("Rules Of Assalto Reale");
    expect(rules).toContain("Capture hierarchy");
    expect(load).toContain("Continue A Match");
    expect(load).toContain("No local save yet");
    expect(settings).toContain("Reduce motion");
    expect(settings).toContain("High contrast board");
  });

  it("renders setup defaults with selected option states", () => {
    const html = renderToStaticMarkup(<SetupPage route="/setup" navigate={navigate} />);

    expect(html).toContain("Configure Battle");
    expect(html).toContain("12 minutes");
    expect(html).toContain("Manual deployment");
    expect(html).toContain("Transform disabled");
    expect(html).toContain('aria-pressed="true"');
  });

  it("renders the game HUD from active match state", () => {
    useGameStore.getState().startQuickMatch({ seed: 88 });
    const html = renderToStaticMarkup(<GamePage navigate={navigate} />);

    expect(html).toContain("Command table");
    expect(html).toContain("Special control");
    expect(html).toContain("Captured");
    expect(html).toContain("Pass");
    expect(html).toContain("Restart");
  });

  it("renders confirmation dialogs without browser alerts", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog title="Restart this match?" confirmLabel="Restart Match" onConfirm={() => undefined} onCancel={() => undefined}>
        <p>Confirm restart.</p>
      </ConfirmDialog>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Restart Match");
    expect(html).toContain("Confirm restart.");
  });
});
