import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { routeFromPathname } from "../app/routes";
import { ConfirmDialog } from "../ui/components";
import { GamePage, PlacementPanel } from "./GamePage";
import { HomePage } from "./HomePage";
import { LoadPage, readSaveSummary } from "./LoadPage";
import { RulesPage } from "./RulesPage";
import { SettingsPage } from "./SettingsPage";
import { SetupPage } from "./SetupPage";

const navigate = () => undefined;

describe("route presentation", () => {
  it("recognizes the current schema-3 save on the Load page", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () =>
          JSON.stringify({
            schema: 3,
            board: { grid: [] },
            savedAt: "2026-07-14T00:00:00.000Z",
            phase: { phase: "playing" },
            currentPlayer: "Black",
            turnCounter: 4,
            matchConfig: { opponent: "Human", placementMode: "Manual", transformEnabled: true },
          }),
      },
    });
    expect(readSaveSummary()).toMatchObject({ valid: true, schema: 3, phase: "playing" });
    vi.unstubAllGlobals();
  });

  it("normalizes unknown routes to Home", () => {
    expect(routeFromPathname("/missing")).toBe("/");
    expect(routeFromPathname("/setup")).toBe("/setup");
  });

  it("recognizes a direct replay route under the GitHub Pages base path", () => {
    vi.stubEnv("BASE_URL", "/Assalto-Reale/");
    expect(routeFromPathname("/Assalto-Reale/account/history/match_direct99")).toBe("/account/history/match_direct99");
    vi.unstubAllEnvs();
  });

  it("renders the streamlined non-game routes with the shared shell", () => {
    const home = renderToStaticMarkup(<HomePage route="/" navigate={navigate} />);
    const rules = renderToStaticMarkup(<RulesPage route="/rules" navigate={navigate} />);
    const load = renderToStaticMarkup(<LoadPage route="/load" navigate={navigate} />);
    const settings = renderToStaticMarkup(<SettingsPage route="/settings" navigate={navigate} />);

    expect(home).toContain("Assalto Reale");
    expect(home).toContain("Start Match");

    expect(rules).toContain("How to Play");
    expect(rules).toContain("Capture hierarchy");
    expect(rules).toContain("All new public matches use manual placement");
    expect(rules).toContain("Transform is enabled in every newly started public match");
    expect(rules).not.toContain("Field manual");
    expect(rules).not.toContain("Quick Balanced");
    expect(rules).not.toContain("parity");
    expect(rules).not.toContain("shield");

    expect(load).toContain("Saved Matches");
    expect(load).toContain("No saved match");
    expect(load).toContain("Import Save");
    expect(load).toContain("Export Current Match");
    expect(load).not.toContain("parity work item");
    expect(load).not.toContain("Schema");

    expect(settings).toContain("Reduce motion");
    expect(settings).toContain("High contrast board");
    expect(settings).toContain("Changes apply immediately");
    expect(settings).toContain("Sound effects");
    expect(settings).toContain("Volume");
    expect(settings).not.toContain("Coming later");
    expect(settings).not.toContain("Not exposed until implemented");
    expect(settings).not.toContain("Audio And Defaults");

    // Discreet build/version line, sourced from build-time constants with an accessible label.
    expect(settings).toContain(`Version ${__APP_VERSION__} · ${__APP_COMMIT__}`);
    expect(settings).toContain(`Application version ${__APP_VERSION__}, build ${__APP_COMMIT__}`);
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
