import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { routeFromPathname } from "../app/routes";
import { useGameStore } from "../game/state/gameStore";
import { ConfirmDialog } from "../ui/components";
import { GamePage, PlacementPanel } from "./GamePage";
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
    expect(home).toContain("Start Match");
    expect(rules).toContain("Rules Of Assalto Reale");
    expect(rules).toContain("Capture hierarchy");
    expect(load).toContain("Continue A Match");
    expect(load).toContain("No local save yet");
    expect(load).toContain("Import JSON");
    expect(load).toContain("Export Current");
    expect(settings).toContain("Reduce motion");
    expect(settings).toContain("High contrast board");
  });

  it("renders the minimal public setup with fixed match rules", () => {
    const html = renderToStaticMarkup(<SetupPage route="/setup" navigate={navigate} />);

    expect(html).toContain("Start a Match");
    expect(html).toContain("Human");
    expect(html).toContain("Computer");
    expect(html).toContain("12 minutes");
    expect(html).toContain("Manual placement · Transform enabled");
    expect(html).toContain('aria-pressed="true"');

    // Removed from the public UI (Human is the default, so side is hidden too).
    expect(html).not.toContain("Quick Balanced");
    expect(html).not.toContain("Easy");
    expect(html).not.toContain("Hard");
    expect(html).not.toContain("Transform disabled");
    expect(html).not.toContain("Random");
  });

  it("renders a board-first game layout without command-table wording", () => {
    const html = renderToStaticMarkup(<GamePage navigate={navigate} />);

    expect(html).toContain("Assalto Reale");
    expect(html).toContain("Pass");
    expect(html).toContain("Captured");
    expect(html).toContain("Restart unavailable until a match setup is stored");
    // Board comes before the controls panel in source order.
    expect(html.indexOf('class="gameBoardArea"')).toBeLessThan(html.indexOf('class="gamePanel"'));
    // Rejected medieval / command-table wording is gone.
    expect(html).not.toContain("Command table");
    expect(html).not.toContain("Orders");
    expect(html).not.toContain("Battle");
  });

  it("renders the compact manual placement panel", () => {
    const piecesLeft = {
      Black: { King: 1, AttackPawn: 4, DefensePawn: 4, ConquestPawn: 4 },
      White: { King: 1, AttackPawn: 4, DefensePawn: 4, ConquestPawn: 4 },
    };
    const html = renderToStaticMarkup(
      <PlacementPanel
        currentPlacement={{ player: "Black", pieceType: "King" }}
        piecesLeft={piecesLeft}
        placementCursor={0}
        placementValidCount={8}
        message="Black: place King."
        undo={() => undefined}
        saveGame={() => undefined}
        disabled={false}
      />,
    );

    expect(html).toContain("Black: place King.");
    expect(html).toContain("Progress");
    expect(html).toContain("0/26");
    expect(html).toContain("Valid squares");
    expect(html).toContain("Undo");
    expect(html).toContain("Save");
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
