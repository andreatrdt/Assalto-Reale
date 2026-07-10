import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnlinePage } from "../pages/OnlinePage";
import { OnlineGameHud } from "./OnlineGameHud";
import { useOnlineMatchStore } from "./onlineStore";

const navigate = vi.fn();

function resetOnlineState() {
  useOnlineMatchStore.setState({
    connectionStatus: "idle",
    connectionDetail: null,
    playerId: null,
    sessionId: null,
    matchId: null,
    inviteCode: null,
    side: null,
    matchVersion: null,
    streamSequence: null,
    waitingForOpponent: false,
    pendingCommandId: null,
    lastError: null,
    lastRejectionCode: null,
    winner: null,
    completed: false,
  });
}

afterEach(() => {
  resetOnlineState();
  navigate.mockReset();
  vi.unstubAllEnvs();
});

describe("online multiplayer presentation", () => {
  it("renders the visible host and join experience when no server is configured", () => {
    const html = renderToStaticMarkup(
      <OnlinePage route="/online" navigate={navigate} />,
    );

    expect(html).toContain("Play Online");
    expect(html).toContain("Create a private match");
    expect(html).toContain("Enter an invite code");
    expect(html).toContain("Server not configured");
    expect(html).toContain("Create Online Match");
    expect(html).toContain("Join Match");
  });

  it("renders a waiting room with invite and connection details", () => {
    useOnlineMatchStore.setState({
      connectionStatus: "connected",
      matchId: "match_online01",
      inviteCode: "INV00001",
      side: "Black",
      matchVersion: 1,
      streamSequence: 1,
      waitingForOpponent: true,
    });

    const html = renderToStaticMarkup(
      <OnlinePage route="/online" navigate={navigate} />,
    );
    expect(html).toContain("Waiting room");
    expect(html).toContain("Invite your opponent");
    expect(html).toContain("INV00001");
    expect(html).toContain("Black");
    expect(html).toContain("Connected");
  });

  it("renders canonical in-game authority and pending status", () => {
    useOnlineMatchStore.setState({
      connectionStatus: "reconnecting",
      connectionDetail: "Connection lost. Reconnecting…",
      matchId: "match_online01",
      inviteCode: "INV00001",
      side: "White",
      matchVersion: 4,
      pendingCommandId: "command_pending01",
      completed: false,
    });

    const html = renderToStaticMarkup(<OnlineGameHud />);
    expect(html).toContain("Reconnecting");
    expect(html).toContain("You play White");
    expect(html).toContain("v4");
    expect(html).toContain("Invite INV00001");
    expect(html).toContain("Connection lost. Reconnecting…");
    expect(html).toContain("Resign");
  });

  it("shows errors and hides resignation for a completed match", () => {
    useOnlineMatchStore.setState({
      connectionStatus: "error",
      matchId: "match_online01",
      side: "Black",
      matchVersion: 8,
      lastError: "The server rejected the command.",
      completed: true,
    });

    const html = renderToStaticMarkup(<OnlineGameHud />);
    expect(html).toContain("Connection error");
    expect(html).toContain("The server rejected the command.");
    expect(html).not.toContain(">Resign<");
  });
});
