import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountContext, type AccountContextValue } from "../account/AccountProvider";
import { AccountPage } from "./AccountPage";

const navigate = vi.fn();
const actions = {
  signIn: async () => undefined,
  signOut: async () => undefined,
  refreshMatches: async () => undefined,
};

function render(value: AccountContextValue): string {
  return renderToStaticMarkup(
    <AccountContext.Provider value={value}>
      <AccountPage route="/account" navigate={navigate} />
    </AccountContext.Provider>,
  );
}

describe("minimal account page", () => {
  it("keeps guest play available when auth is disabled", () => {
    const html = render({ state: "guest", enabled: false, account: null, matches: [], error: null, ...actions });
    expect(html).toContain("Continue without an account");
    expect(html).toContain("Play online as guest");
  });

  it.each([
    ["signing-in", "Completing secure sign-in"],
    ["auth-failed", "Authentication failed"],
    ["session-expired", "Session expired"],
    ["signed-out", "Guest player"],
  ] as const)("renders the %s state", (state, copy) => {
    const html = render({
      state,
      enabled: true,
      account: null,
      matches: [],
      error: state === "auth-failed" ? "Failed safely." : null,
      ...actions,
    });
    expect(html).toContain(copy);
  });

  it("shows only durable identity, active matches and logout for signed-in users", () => {
    const html = render({
      state: "signed-in",
      enabled: true,
      account: {
        kind: "registered",
        user: { userId: "user_1", status: "active", email: "player@example.test" },
        playerId: "player_1",
        sessionId: "session_1",
        expiresAt: "2030-01-01T00:00:00.000Z",
      },
      matches: [{ matchId: "match_account01", side: "White", status: "active", updatedAt: "2028-01-01T00:00:00.000Z" }],
      error: null,
      ...actions,
    });
    expect(html).toContain("player@example.test");
    expect(html).toContain("match_account01");
    expect(html).toContain("Sign out");
    expect(html).not.toMatch(/rating|leaderboard|match history/i);
  });
});
