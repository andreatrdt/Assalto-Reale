// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchHistoryDetails } from "../online/protocol";
import type { AccountContextValue } from "../account/AccountProvider";
import type { HistoricalReplayFrame } from "../game/engine";
import { defendedKingPreviewForFrame, MatchHistoryReplayPage } from "./MatchHistoryReplayPage";

const mocks = vi.hoisted(() => ({
  account: { current: null as AccountContextValue | null },
  replay: vi.fn(),
}));

vi.mock("../account/AccountProvider", async (importOriginal) => {
  const original = await importOriginal<typeof import("../account/AccountProvider")>();
  return { ...original, useAccount: () => mocks.account.current };
});

vi.mock("../game/engine", async (importOriginal) => {
  const original = await importOriginal<typeof import("../game/engine")>();
  return { ...original, replayHistoricalMatch: mocks.replay };
});

vi.mock("../board/GameBoard", () => ({
  GameBoard: () => <div data-testid="historical-board">Historical board</div>,
}));

vi.mock("../ui/components", () => ({
  GameButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
  PageShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Panel: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  StatusBadge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

function state(phase: "placement" | "playing" | "gameOver", territory = false): HistoricalReplayFrame["state"] {
  return {
    rulesVersion: 2,
    seed: 0,
    phase,
    currentPlayer: "Black",
    movesThisTurn: 0,
    kingMoved: false,
    turnCounter: 0,
    placementCursor: 0,
    currentPlacement: null,
    piecesLeft: {
      Black: { King: 0, AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0 },
      White: { King: 0, AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0 },
    },
    pendingDefendedKing: null,
    pendingTransform: null,
    victory: phase === "gameOver" ? { winner: "Black", loser: "White", reason: "king_capture" } : null,
    board: {
      config: { rows: 12, cols: 12, specialCount: 5, transformEnabled: true, transformRound: 10 },
      grid: Array.from({ length: 12 }, () => Array(12).fill(null)),
      specialSquares: [],
      transformSquares: [],
      controlledSquares: { Black: [], White: [] },
      territoryClaim: territory ? { claimant: "Black", createdTurn: 3, matureTurn: 5 } : null,
      capturedPieces: {
        Black: { King: 0, AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0 },
        White: { King: 0, AttackPawn: 0, DefensePawn: 0, ConquestPawn: 0 },
      },
    },
  };
}

function transitionEvent(kind: "capture" | "transform"): HistoricalReplayFrame["events"][number] {
  return {
    type: "ActionApplied",
    action: { kind: "pass", player: "Black", cost: 0, capture: false, endsTurn: true },
    transition: {
      action: { kind: "pass", player: "Black", cost: 0, capture: false, endsTurn: true },
      events: [{ kind, data: {} }],
      victory: null,
      specialControl: null,
      endsTurn: true,
      nextMovesThisTurn: 0,
      nextKingMoved: false,
    },
  } as HistoricalReplayFrame["events"][number];
}

function replayFrames(): HistoricalReplayFrame[] {
  return [
    { sequenceNumber: 0, command: null, state: state("placement"), events: [], terminal: null },
    { sequenceNumber: 1, command: { type: "PlacePiece", position: [0, 0] }, state: state("playing"), events: [], terminal: null },
    {
      sequenceNumber: 2,
      command: { type: "SubmitAction", start: [0, 0], end: [0, 1] },
      state: state("playing"),
      events: [transitionEvent("capture")],
      terminal: null,
    },
    {
      sequenceNumber: 3,
      command: { type: "ChooseTransform", newType: "DefensePawn" },
      state: state("playing"),
      events: [transitionEvent("transform")],
      terminal: null,
    },
    { sequenceNumber: 4, command: { type: "PassTurn" }, state: state("playing", true), events: [], terminal: null },
    {
      sequenceNumber: 5,
      command: { type: "PassTurn" },
      state: state("gameOver", true),
      events: [],
      terminal: { winner: "Black", loser: "White", reason: "king_capture" },
    },
  ];
}

const details: MatchHistoryDetails = {
  matchId: "match_history01",
  createdAt: "2028-01-01T00:00:00.000Z",
  startedAt: "2028-01-01T00:00:01.000Z",
  completedAt: "2028-01-01T00:01:01.000Z",
  players: {
    Black: { side: "Black", kind: "registered", displayIdentity: "Player" },
    White: { side: "White", kind: "guest", displayIdentity: "Guest" },
  },
  viewerSide: "Black",
  result: "win",
  winner: "Black",
  victoryReason: "king_capture",
  durationSeconds: 60,
  turnCount: 5,
  predecessorMatchId: null,
  successorMatchId: null,
  finalMatchVersion: 8,
  rulesVersion: 1,
  protocolVersion: 1,
  replaySchemaVersion: 1,
  replayAvailable: true,
  integrityChecksum: "1234567890abcdef1234567890abcdef",
  seed: 2,
  config: {
    visibility: "invite",
    placementMode: "QuickBalanced",
    transformEnabled: true,
    preferredSide: "Random",
    timeControl: { kind: "untimed" },
  },
  finalSnapshot: state("gameOver") as unknown as MatchHistoryDetails["finalSnapshot"],
  statistics: {
    Black: { capturesMade: 1, piecesLost: 0, transformations: 1, defendedKingSacrifices: 0, territoryClaimsCreated: 1 },
    White: { capturesMade: 0, piecesLost: 1, transformations: 0, defendedKingSacrifices: 0, territoryClaimsCreated: 0 },
  },
  events: [],
};

const navigate = vi.fn();
const loadHistoryMatch = vi.fn<() => Promise<MatchHistoryDetails>>();

function account(overrides: Partial<AccountContextValue> = {}): AccountContextValue {
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
    loadHistoryMatch,
    ...overrides,
  };
}

function renderPage(route: `/account/history/${string}` = "/account/history/match_history01") {
  return render(<MatchHistoryReplayPage route={route} navigate={navigate} />);
}

async function renderSuccessfulReplay(): Promise<void> {
  loadHistoryMatch.mockResolvedValue(details);
  renderPage();
  await screen.findByTestId("historical-board");
}

describe("match history replay page", () => {
  it("exposes the recorded semantic defended-King route to the replay board", () => {
    const selectedRoute = {
      id: "counterClockwise" as const,
      path: [
        [6, 4],
        [6, 3],
      ] as Array<readonly [number, number]>,
      jumpedSquares: [[5, 3]] as Array<readonly [number, number]>,
      turnSquares: [[6, 4]] as Array<readonly [number, number]>,
      landingPosition: [6, 3] as const,
    };
    const action = {
      kind: "capture" as const,
      player: "Black" as const,
      start: [5, 2] as const,
      end: [5, 4] as const,
      cost: 2,
      capture: true,
      endsTurn: true,
      defendedKing: {
        attackerId: "5,2",
        kingId: "5,4",
        attackerOrigin: [5, 2] as const,
        kingPosition: [5, 4] as const,
        attackDirection: [0, 1] as const,
        bounceDirection: [0, -1] as const,
        attackPath: [
          [5, 3],
          [5, 4],
        ] as Array<readonly [number, number]>,
        bouncePath: selectedRoute.path,
        landingPosition: selectedRoute.landingPosition,
        routes: [selectedRoute],
        selectedRouteId: selectedRoute.id,
        pathDefenderId: "5,3",
        eligibleDefenderIds: ["5,3"],
        triggersTransform: false,
        actionCost: 2,
        endsTurn: true,
      },
    };
    const frame: HistoricalReplayFrame = {
      sequenceNumber: 7,
      command: { type: "SubmitAction", start: [5, 2], end: [5, 4], routeId: selectedRoute.id },
      state: state("playing"),
      terminal: null,
      events: [
        {
          type: "ActionApplied",
          action,
          transition: {
            action,
            events: [{ kind: "defended_king", data: { defender: [5, 3] } }],
            victory: null,
            specialControl: null,
            endsTurn: true,
            nextMovesThisTurn: 0,
            nextKingMoved: false,
          },
        },
      ],
    };

    expect(defendedKingPreviewForFrame(frame)).toMatchObject({
      selectedRouteId: "counterClockwise",
      routes: [selectedRoute],
      defenders: [[5, 3]],
    });
  });

  beforeEach(() => {
    mocks.account.current = account();
    mocks.replay.mockReturnValue({ ok: true, frames: replayFrames() });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a loading state while immutable details are requested", () => {
    loadHistoryMatch.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByText("Loading immutable match record...")).toBeTruthy();
  });

  it("renders a successful private history detail", async () => {
    await renderSuccessfulReplay();
    expect(screen.getByText("Victory")).toBeTruthy();
    expect(screen.getByText("king capture")).toBeTruthy();
    expect(screen.getByText("Integrity: 1234567890abcdef...")).toBeTruthy();
    expect(loadHistoryMatch).toHaveBeenCalledWith("match_history01");
  });

  it("navigates to previous and next replay frames", async () => {
    await renderSuccessfulReplay();
    fireEvent.click(screen.getByRole("button", { name: "Next event" }));
    expect(screen.getByText("Event 1 of 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("Event 0 of 5")).toBeTruthy();
  });

  it("jumps directly to first and final frames", async () => {
    await renderSuccessfulReplay();
    fireEvent.click(screen.getByRole("button", { name: "Final" }));
    expect(screen.getByText("Event 5 of 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "First" }));
    expect(screen.getByText("Event 0 of 5")).toBeTruthy();
  });

  it("plays, pauses, and stops at the final frame", async () => {
    await renderSuccessfulReplay();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText("Event 1 of 5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText("Event 1 of 5")).toBeTruthy();
  });

  it("changes playback speed", async () => {
    await renderSuccessfulReplay();
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("Playback speed"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByText("Event 1 of 5")).toBeTruthy();
  });

  it.each([
    ["Placement complete", 1],
    ["First capture", 2],
    ["Transformation", 3],
    ["Territory claim", 4],
  ] as const)("jumps to the %s milestone", async (label, index) => {
    await renderSuccessfulReplay();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(screen.getByText(`Event ${index} of 5`)).toBeTruthy();
  });

  it("renders a preserved legacy result when replay events are unavailable", async () => {
    loadHistoryMatch.mockResolvedValue({ ...details, replayAvailable: false });
    renderPage();
    expect(await screen.findByText("Replay unavailable")).toBeTruthy();
    expect(screen.getByText(/predates complete replay capture/)).toBeTruthy();
  });

  it("renders unsupported or corrupt replay errors without a board", async () => {
    mocks.replay.mockReturnValue({ ok: false, code: "invalid_replay", message: "Replay event 3 is corrupt." });
    loadHistoryMatch.mockResolvedValue(details);
    renderPage();
    expect(await screen.findByText("Replay event 3 is corrupt.")).toBeTruthy();
    expect(screen.queryByTestId("historical-board")).toBeNull();
  });

  it("renders API failures clearly", async () => {
    loadHistoryMatch.mockRejectedValue(new Error("unauthorized"));
    renderPage();
    expect((await screen.findByRole("alert")).textContent).toContain("could not be loaded");
  });

  it("renders an explicit session-expired state without requesting history", () => {
    mocks.account.current = account({ state: "session-expired", account: null });
    renderPage();
    expect(screen.getByRole("alert").textContent).toContain("session expired");
    expect(loadHistoryMatch).not.toHaveBeenCalled();
  });

  it("loads direct replay routes and never invokes account mutation actions", async () => {
    const value = account();
    mocks.account.current = value;
    loadHistoryMatch.mockResolvedValue(details);
    renderPage("/account/history/match_direct99");
    await waitFor(() => expect(loadHistoryMatch).toHaveBeenCalledWith("match_direct99"));
    fireEvent.click(screen.getByRole("button", { name: "Final" }));
    expect(value.signIn).not.toHaveBeenCalled();
    expect(value.signOut).not.toHaveBeenCalled();
    expect(value.refreshMatches).not.toHaveBeenCalled();
  });
});
