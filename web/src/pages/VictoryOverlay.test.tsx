import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VictoryOverlay } from "./VictoryOverlay";

const noop = () => undefined;

describe("VictoryOverlay", () => {
  it("announces an accessible victory with canonical outcome and actions", () => {
    const html = renderToStaticMarkup(<VictoryOverlay message="White wins by king_capture." humanIsWinner={null} rematch={noop} newMatch={noop} home={noop} saveGame={noop} />);

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain(">Victory<");
    expect(html).toContain("White wins by capturing the King.");
    expect(html).toContain("Rematch");
    expect(html).toContain("New Match");
    expect(html).toContain("View final board");
  });

  it("shows Defeat when the local human lost", () => {
    const html = renderToStaticMarkup(<VictoryOverlay message="White wins by timeout." humanIsWinner={false} rematch={noop} newMatch={noop} home={noop} saveGame={noop} />);

    expect(html).toContain(">Defeat<");
    expect(html).toContain("White wins on time.");
    expect(html).toContain("isDefeat");
  });
});
