import { useMemo, useState } from "react";
import type { AppRoute } from "../app/routes";
import { useAccount } from "../account/AccountProvider";
import { useOnlineMatchStore } from "../online/onlineStore";
import { GameButton, PageHeader, PageShell, Panel, StatusBadge } from "../ui/components";
import "../styles/account.css";

interface AccountPageProps {
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
}

export function AccountPage({ route, navigate }: AccountPageProps) {
  const account = useAccount();
  const resumeAccountMatch = useOnlineMatchStore((state) => state.resumeAccountMatch);
  const [historyResultFilter, setHistoryResultFilter] = useState<"all" | "win" | "loss" | "draw">("all");
  const [historySideFilter, setHistorySideFilter] = useState<"all" | "Black" | "White">("all");
  const visibleHistory = useMemo(
    () =>
      account.history.filter(
        (match) =>
          (historyResultFilter === "all" || match.result === historyResultFilter) &&
          (historySideFilter === "all" || match.side === historySideFilter),
      ),
    [account.history, historyResultFilter, historySideFilter],
  );

  async function resume(matchId: string, side: "Black" | "White") {
    if (await resumeAccountMatch(matchId, side)) navigate("/game");
    else navigate("/online");
  }

  const guest = account.state === "guest" || account.state === "signed-out";
  return (
    <PageShell activeRoute={route} navigate={navigate} className="accountShell">
      <PageHeader
        eyebrow="Identity"
        title="Account"
        description="Sign in to keep one durable player identity across approved browsers. Guest play remains available."
      />

      {!account.enabled ? (
        <Panel className="accountPanel">
          <StatusBadge tone="neutral" icon="shield">
            Guest
          </StatusBadge>
          <h2>Continue without an account</h2>
          <p>Registered accounts are not configured for this deployment. Private online matches still work in guest mode.</p>
          <GameButton variant="primary" onClick={() => navigate("/online")}>
            Play online as guest
          </GameButton>
        </Panel>
      ) : account.state === "checking-session" ? (
        <Panel className="accountPanel" aria-live="polite">
          <StatusBadge tone="info" icon="clock">
            Checking session
          </StatusBadge>
          <h2>Restoring your account…</h2>
          <p>Guest play will remain available if there is no active account session.</p>
        </Panel>
      ) : account.state === "signing-in" ? (
        <Panel className="accountPanel" aria-live="polite">
          <StatusBadge tone="info" icon="clock">
            Signing in
          </StatusBadge>
          <h2>Completing secure sign-in…</h2>
          <p>You can close this page if the identity provider does not return.</p>
        </Panel>
      ) : account.state === "signed-in" && account.account ? (
        <div className="accountGrid">
          <Panel className="accountPanel">
            <StatusBadge tone="success" icon="check">
              Signed in
            </StatusBadge>
            <h2>{account.account.user.email ?? "Registered player"}</h2>
            <p className="accountIdentity">Player identity: {account.account.playerId}</p>
            <div className="accountActions">
              <GameButton variant="secondary" onClick={() => void account.refreshMatches()}>
                Refresh matches
              </GameButton>
              <GameButton variant="danger" onClick={() => void account.signOut()}>
                Sign out
              </GameButton>
            </div>
          </Panel>
          <section className="accountMatches" aria-labelledby="active-matches-title">
            <h2 id="active-matches-title">Active private matches</h2>
            {account.matches.length === 0 ? (
              <Panel>
                <p>No active account-linked matches.</p>
              </Panel>
            ) : (
              account.matches.map((match) => (
                <Panel key={match.matchId} className="accountMatch">
                  <div>
                    <strong>{match.matchId}</strong>
                    <p>
                      {match.side} · {match.status === "active" ? "In progress" : "Waiting for opponent"}
                    </p>
                  </div>
                  <GameButton variant="primary" size="sm" onClick={() => void resume(match.matchId, match.side)}>
                    Resume
                  </GameButton>
                </Panel>
              ))
            )}
          </section>
          <section className="accountMatches" aria-labelledby="player-statistics-title">
            <div className="accountSectionHeading">
              <h2 id="player-statistics-title">Player statistics</h2>
              <GameButton variant="secondary" size="sm" onClick={() => void account.refreshHistory()}>
                Refresh history
              </GameButton>
            </div>
            {account.statistics ? (
              <Panel className="accountStatistics">
                <div>
                  <strong>{account.statistics.gamesPlayed}</strong>
                  <span>Games</span>
                </div>
                <div>
                  <strong>{account.statistics.wins}</strong>
                  <span>Wins</span>
                </div>
                <div>
                  <strong>{account.statistics.losses}</strong>
                  <span>Losses</span>
                </div>
                <div>
                  <strong>{account.statistics.currentWinStreak}</strong>
                  <span>Current streak</span>
                </div>
                <div>
                  <strong>{account.statistics.capturesMade}</strong>
                  <span>Captures</span>
                </div>
                <div>
                  <strong>{account.statistics.transformations}</strong>
                  <span>Transformations</span>
                </div>
              </Panel>
            ) : (
              <Panel>
                <p>{account.historyLoading ? "Loading statistics..." : "No completed-match statistics yet."}</p>
              </Panel>
            )}
          </section>
          <section className="accountMatches" aria-labelledby="match-history-title">
            <h2 id="match-history-title">Match History</h2>
            <div className="accountActions" aria-label="Match history filters">
              <label>
                Result
                <select
                  aria-label="History result"
                  value={historyResultFilter}
                  onChange={(event) => setHistoryResultFilter(event.currentTarget.value as typeof historyResultFilter)}
                >
                  <option value="all">All results</option>
                  <option value="win">Victories</option>
                  <option value="loss">Defeats</option>
                  <option value="draw">Draws</option>
                </select>
              </label>
              <label>
                Side
                <select
                  aria-label="History side"
                  value={historySideFilter}
                  onChange={(event) => setHistorySideFilter(event.currentTarget.value as typeof historySideFilter)}
                >
                  <option value="all">Both sides</option>
                  <option value="Black">Black</option>
                  <option value="White">White</option>
                </select>
              </label>
            </div>
            {account.historyError ? (
              <Panel>
                <p role="alert">{account.historyError}</p>
              </Panel>
            ) : null}
            {account.historyLoading && account.history.length === 0 ? (
              <Panel>
                <p>Loading completed matches...</p>
              </Panel>
            ) : account.history.length === 0 ? (
              <Panel>
                <p>No completed online matches yet.</p>
              </Panel>
            ) : visibleHistory.length === 0 ? (
              <Panel>
                <p>No completed matches match these filters.</p>
              </Panel>
            ) : (
              visibleHistory.map((match) => (
                <Panel key={match.matchId} className="accountMatch accountHistoryMatch">
                  <div>
                    <strong>
                      {match.result === "win" ? "Victory" : match.result === "loss" ? "Defeat" : "Draw"} vs {match.opponent.displayIdentity}
                    </strong>
                    <p>
                      {match.side} - {match.victoryReason.replaceAll("_", " ")} - {match.turnCount} turns
                    </p>
                    <small>{new Date(match.completedAt).toLocaleString()}</small>
                  </div>
                  <GameButton
                    variant="primary"
                    size="sm"
                    disabled={!match.replayAvailable}
                    onClick={() => navigate(`/account/history/${match.matchId}`)}
                  >
                    {match.replayAvailable ? "View replay" : "Replay unavailable"}
                  </GameButton>
                </Panel>
              ))
            )}
            {account.historyNextCursor ? (
              <GameButton variant="secondary" size="sm" disabled={account.historyLoading} onClick={() => void account.loadMoreHistory()}>
                {account.historyLoading ? "Loading..." : "Load more matches"}
              </GameButton>
            ) : null}
          </section>
        </div>
      ) : (
        <Panel className="accountPanel">
          <StatusBadge
            tone={account.state === "session-expired" || account.state === "auth-failed" ? "danger" : "neutral"}
            icon={account.state === "session-expired" ? "warning" : "shield"}
          >
            {account.state === "session-expired" ? "Session expired" : account.state === "auth-failed" ? "Authentication failed" : "Guest"}
          </StatusBadge>
          <h2>{guest ? "Guest player" : "Sign-in needs attention"}</h2>
          <p>{account.error ?? "Sign in for a durable identity and cross-device private-match resume, or continue as a guest."}</p>
          <div className="accountActions">
            <GameButton variant="primary" onClick={() => void account.signIn()}>
              Sign in
            </GameButton>
            <GameButton variant="secondary" onClick={() => navigate("/online")}>
              Continue as guest
            </GameButton>
          </div>
        </Panel>
      )}
    </PageShell>
  );
}
