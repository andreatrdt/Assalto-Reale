import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountContext, type AccountContextValue } from "../account/AccountProvider";
import { HomePage, onlineHomeAction } from "./HomePage";

const navigate = () => undefined;

function renderHome(account?: AccountContextValue) {
  const home = <HomePage route="/" navigate={navigate} />;
  return renderToStaticMarkup(account ? <AccountContext.Provider value={account}>{home}</AccountContext.Provider> : home);
}

// Note: zustand v5 renders its React SSR snapshot from getInitialState(), so
// renderToStaticMarkup always reflects the initial store state (no active
// match). That covers the default "no Continue" case here; the reactive
// "Resume Match appears after a match starts" branch is verified in the
// Playwright e2e (real browser, live store snapshot).
describe("Home page", () => {
  it("shows the strong wordmark, value line and primary Start Match action", () => {
    const html = renderHome();

    expect(html).toContain("Assalto");
    expect(html).toContain("Reale");
    expect(html).toContain("Control. Sacrifice. Conquer.");
    expect(html).toContain("Start Match");
    expect(html).toContain('id="home-title"');
    expect(html).toContain('aria-label="Assalto Reale"');
    expect(html).toContain("homeTitleAccent");
  });

  it("offers restrained Rules and Settings actions", () => {
    const html = renderHome();

    expect(html).toContain(">Rules<");
    expect(html).toContain(">Settings<");
  });

  it("hides Resume Match by default (no active match)", () => {
    const html = renderHome();

    expect(html).not.toContain("Resume Match");
  });

  it("uses distinct active, post-game, and exited online actions", () => {
    expect(
      onlineHomeAction({
        matchId: "match_active01",
        lifecycle: "active",
        selfPostGamePresence: null,
      }),
    ).toBe("Resume Match");
    expect(
      onlineHomeAction({
        matchId: "match_ended01",
        lifecycle: "postGame",
        selfPostGamePresence: "present",
      }),
    ).toBe("Return to post-game room");
    expect(
      onlineHomeAction({
        matchId: "match_ended01",
        lifecycle: "postGame",
        selfPostGamePresence: "absent",
      }),
    ).toBe("Play Online");
  });

  it("does not settle into a false Sign in action while checking the provider session", () => {
    const html = renderHome({
      state: "checking-session",
      enabled: true,
      account: null,
      matches: [],
      error: null,
      signIn: async () => undefined,
      signOut: async () => undefined,
      refreshMatches: async () => undefined,
    });

    expect(html).toContain("Checking account");
    expect(html).toContain("disabled");
    expect(html).not.toContain(">Sign in<");
  });

  it("keeps the homepage minimal and free of rejected decorative elements", () => {
    const html = renderHome();

    expect(html).not.toContain("Medieval abstract strategy");
    expect(html).not.toContain("royalBoardPreview");
    expect(html).not.toContain("heroCrest");
    expect(html).not.toContain("brandCrest");
    expect(html).not.toContain("factionBadge");
    expect(html).not.toContain("12x12");
  });
});
