// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext, type AccountContextValue } from "../account/AccountProvider";
import type { MatchHistorySummary } from "../online/protocol";
import { AccountPage } from "./AccountPage";

vi.mock("../online/onlineStore", () => ({
  useOnlineMatchStore: (selector: (state: { resumeAccountMatch: () => Promise<boolean> }) => unknown) =>
    selector({ resumeAccountMatch: async () => false }),
}));

vi.mock("../ui/components", () => ({
  GameButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  PageShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Panel: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  StatusBadge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const win: MatchHistorySummary = {
  matchId: "match_history_win",
  completedAt: "2028-01-01T00:00:00.000Z",
  opponent: { side: "White", kind: "guest", displayIdentity: "Guest one" },
  side: "Black",
  result: "win",
  victoryReason: "king_capture",
  durationSeconds: 60,
  turnCount: 5,
  predecessorMatchId: null,
  successorMatchId: null,
  replayAvailable: true,
};

const loss: MatchHistorySummary = {
  ...win,
  matchId: "match_history_loss",
  opponent: { side: "Black", kind: "registered", displayIdentity: "Player two" },
  side: "White",
  result: "loss",
  victoryReason: "territory",
  replayAvailable: false,
};

function value(overrides: Partial<AccountContextValue> = {}): AccountContextValue {
  return {
    state: "signed-in",
    enabled: true,
    account: {
      kind: "registered",
      user: { userId: "user_1", status: "active", email: "player@example.test" },
      playerId: "player_1",
      sessionId: "session_1",
      expiresAt: "2030-01-01T00:00:00.000Z",
    },
    matches: [],
    history: [],
    historyNextCursor: null,
    statistics: null,
    historyLoading: false,
    historyError: null,
    error: null,
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    refreshMatches: vi.fn(async () => undefined),
    refreshHistory: vi.fn(async () => undefined),
    loadMoreHistory: vi.fn(async () => undefined),
    loadHistoryMatch: vi.fn(async () => {
      throw new Error("not loaded");
    }),
    ...overrides,
  };
}

function renderPage(account: AccountContextValue, navigate = vi.fn()) {
  render(
    <AccountContext.Provider value={account}>
      <AccountPage route="/account" navigate={navigate} />
    </AccountContext.Provider>,
  );
  return navigate;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("account history and statistics", () => {
  it("renders empty history and statistics states", () => {
    renderPage(value());
    expect(screen.getByText("No completed online matches yet.")).toBeTruthy();
    expect(screen.getByText("No completed-match statistics yet.")).toBeTruthy();
  });

  it("renders populated history and the statistics summary", () => {
    renderPage(
      value({
        history: [win, loss],
        statistics: {
          gamesPlayed: 9,
          wins: 5,
          losses: 3,
          draws: 1,
          kingCaptureWins: 2,
          territoryWins: 2,
          timeoutWins: 0,
          resignationWins: 1,
          blackGames: 5,
          blackWins: 3,
          whiteGames: 4,
          whiteWins: 2,
          totalTurns: 50,
          totalDurationSeconds: 900,
          capturesMade: 12,
          piecesLost: 10,
          transformations: 4,
          defendedKingSacrifices: 1,
          territoryClaimsCreated: 3,
          currentWinStreak: 2,
          longestWinStreak: 4,
          updatedAt: "2028-01-01T00:00:00.000Z",
          version: 1,
        },
      }),
    );
    expect(screen.getByText(/Victory vs Guest one/)).toBeTruthy();
    expect(screen.getByText(/Defeat vs Player two/)).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("loads the next history page", () => {
    const loadMoreHistory = vi.fn(async () => undefined);
    renderPage(value({ history: [win], historyNextCursor: "next-page", loadMoreHistory }));
    fireEvent.click(screen.getByRole("button", { name: "Load more matches" }));
    expect(loadMoreHistory).toHaveBeenCalledTimes(1);
  });

  it("filters completed matches by result and side", () => {
    renderPage(value({ history: [win, loss] }));
    fireEvent.change(screen.getByLabelText("History result"), { target: { value: "loss" } });
    expect(screen.queryByText(/Victory vs Guest one/)).toBeNull();
    expect(screen.getByText(/Defeat vs Player two/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("History side"), { target: { value: "Black" } });
    expect(screen.getByText("No completed matches match these filters.")).toBeTruthy();
  });

  it("opens replay-capable records and disables legacy replay links", () => {
    const navigate = renderPage(value({ history: [win, loss] }));
    fireEvent.click(screen.getByRole("button", { name: "View replay" }));
    expect(navigate).toHaveBeenCalledWith("/account/history/match_history_win");
    expect((screen.getByRole("button", { name: "Replay unavailable" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the session-expired branch without exposing private history", () => {
    renderPage(value({ state: "session-expired", account: null, history: [win], error: "Session ended." }));
    expect(screen.getByText("Session expired")).toBeTruthy();
    expect(screen.queryByText("Match History")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });
});
