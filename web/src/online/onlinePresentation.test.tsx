import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnlinePage, shouldReopenBoard } from "../pages/OnlinePage";

const navigate = vi.fn();

afterEach(() => {
  navigate.mockReset();
  vi.unstubAllEnvs();
});

describe("online multiplayer presentation", () => {
  it("renders the visible host and join experience when no server is configured", () => {
    const html = renderToStaticMarkup(<OnlinePage route="/online" navigate={navigate} />);

    expect(html).toContain("Play Online");
    expect(html).toContain("Create a private match");
    expect(html).toContain("Enter an invite code");
    expect(html).toContain("Server not configured");
    expect(html).toContain("Create Online Match");
    expect(html).toContain("Join Match");
  });
});

// The reconnect panel content and click → snapshot → navigation are reactive
// (store-driven) branches; per this repo's testing model those are covered by the
// onlineStore state-machine tests and live/e2e, not static SSR render. The pure
// navigation decision is unit-tested here.
describe("online reconnect navigation guard", () => {
  it("reopens the board once a placement match is hydrated", () => {
    expect(shouldReopenBoard({ matchId: "m1", hasActiveMatch: true, waitingForOpponent: false })).toBe(true);
  });

  it("reopens the board for a hydrated match in play", () => {
    // Placement and playing both reopen /game; the board renders the phase.
    expect(shouldReopenBoard({ matchId: "m1", hasActiveMatch: true, waitingForOpponent: false })).toBe(true);
  });

  it("stays on the waiting room until the opponent joins", () => {
    expect(shouldReopenBoard({ matchId: "m1", hasActiveMatch: true, waitingForOpponent: true })).toBe(false);
  });

  it("does not navigate on a connected socket alone (not yet hydrated)", () => {
    expect(shouldReopenBoard({ matchId: "m1", hasActiveMatch: false, waitingForOpponent: false })).toBe(false);
  });

  it("does not navigate without a persisted match", () => {
    expect(shouldReopenBoard({ matchId: null, hasActiveMatch: true, waitingForOpponent: false })).toBe(false);
  });
});
