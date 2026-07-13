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
