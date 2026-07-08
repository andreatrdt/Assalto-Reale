import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomePage } from "./HomePage";

const navigate = () => undefined;

function renderHome() {
  return renderToStaticMarkup(<HomePage route="/" navigate={navigate} />);
}

// Note: zustand v5 renders its React SSR snapshot from getInitialState(), so
// renderToStaticMarkup always reflects the initial store state (no active
// match). That covers the default "no Continue" case here; the reactive
// "Continue Last Match appears after a match starts" branch is verified in the
// Playwright e2e (real browser, live store snapshot).
describe("Home page", () => {
  it("shows the plain title and the primary Start Match action", () => {
    const html = renderHome();

    expect(html).toContain("Assalto Reale");
    expect(html).toContain("Start Match");
    expect(html).toContain('id="home-title"');
  });

  it("offers restrained Rules and Settings actions", () => {
    const html = renderHome();

    expect(html).toContain(">Rules<");
    expect(html).toContain(">Settings<");
  });

  it("hides Continue Last Match by default (no active match)", () => {
    const html = renderHome();

    expect(html).not.toContain("Continue Last Match");
  });

  it("drops the rejected decorative homepage elements", () => {
    const html = renderHome();

    expect(html).not.toContain("Medieval abstract strategy");
    expect(html).not.toContain("royalBoardPreview");
    expect(html).not.toContain("heroCrest");
    expect(html).not.toContain("brandCrest");
    expect(html).not.toContain("factionBadge");
    expect(html).not.toContain("12x12");
  });
});
