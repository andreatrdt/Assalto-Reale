import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearGuestSession, loadGuestSession, setRegisteredSessionProvider } from "../online/onlineIdentity";
import { useOnlineMatchStore } from "../online/onlineStore";
import { AccountApiError, accountApi, type AccountSummary, type ActiveAccountMatch } from "./accountApi";
import { browserAuthConfig, fixedLoginReturnUri, type BrowserAuthConfig } from "./authConfig";

export type AccountState = "guest" | "signing-in" | "signed-in" | "auth-failed" | "session-expired" | "signed-out";

export interface AccountContextValue {
  state: AccountState;
  enabled: boolean;
  account: AccountSummary | null;
  matches: ActiveAccountMatch[];
  error: string | null;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  refreshMatches(): Promise<void>;
}

const disabledValue: AccountContextValue = {
  state: "guest",
  enabled: false,
  account: null,
  matches: [],
  error: null,
  signIn: async () => undefined,
  signOut: async () => undefined,
  refreshMatches: async () => undefined,
};

export const AccountContext = createContext<AccountContextValue>(disabledValue);

export function useAccount(): AccountContextValue {
  return useContext(AccountContext);
}

function AccountBridge({ config, children }: { config: BrowserAuthConfig; children: ReactNode }) {
  const { error: providerError, getAccessTokenSilently, isAuthenticated, isLoading, loginWithRedirect, logout } = useAuth0();
  const [state, setState] = useState<AccountState>("guest");
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [matches, setMatches] = useState<ActiveAccountMatch[]>([]);
  const [error, setError] = useState<string | null>(null);

  const accessToken = useCallback(
    () => getAccessTokenSilently({ authorizationParams: { audience: config.audience } }),
    [config.audience, getAccessTokenSilently],
  );

  const refreshMatches = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setMatches(await accountApi.matches(config.apiBaseUrl, await accessToken()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load active matches.");
    }
  }, [accessToken, config.apiBaseUrl, isAuthenticated]);

  useEffect(() => {
    if (isLoading) {
      setState("signing-in");
      return;
    }
    if (providerError) {
      setState("auth-failed");
      setError("Sign-in could not be completed. Try again.");
      return;
    }
    if (!isAuthenticated) {
      setRegisteredSessionProvider(null);
      setAccount(null);
      setMatches([]);
      setState((current) => (current === "signed-out" ? current : "guest"));
      return;
    }

    let cancelled = false;
    setState("signing-in");
    void (async () => {
      try {
        const token = await accessToken();
        let current = await accountApi.establish(config.apiBaseUrl, token);
        const guest = loadGuestSession();
        if (guest) {
          current = await accountApi.upgradeGuest(config.apiBaseUrl, token, guest.token);
          clearGuestSession();
          useOnlineMatchStore.getState().disconnect(true);
        }
        if (cancelled) return;
        setRegisteredSessionProvider(async (_websocketUrl, matchId) => {
          const ticket = await accountApi.websocketTicket(config.apiBaseUrl, await accessToken(), matchId);
          return { ...ticket, token: ticket.ticket, authKind: "registered" };
        });
        useOnlineMatchStore.getState().disconnect(true);
        setAccount(current);
        setMatches(await accountApi.matches(config.apiBaseUrl, token));
        setError(null);
        setState("signed-in");
      } catch (reason) {
        if (cancelled) return;
        setRegisteredSessionProvider(null);
        setAccount(null);
        if (reason instanceof AccountApiError && reason.status === 401) {
          setState("session-expired");
          setError("Your account session has expired. Sign in again.");
        } else {
          setState("auth-failed");
          setError(reason instanceof Error ? reason.message : "Sign-in could not be completed.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, config.apiBaseUrl, isAuthenticated, isLoading, providerError]);

  const signIn = useCallback(async () => {
    setState("signing-in");
    setError(null);
    await loginWithRedirect({ appState: { returnTo: "/account" } });
  }, [loginWithRedirect]);

  const signOut = useCallback(async () => {
    setRegisteredSessionProvider(null);
    useOnlineMatchStore.getState().disconnect(false);
    clearGuestSession();
    try {
      if (isAuthenticated) await accountApi.logout(config.apiBaseUrl, await accessToken());
    } catch {
      // Provider logout still runs when the backend is temporarily unreachable.
      // The local ticket source is already disabled and no app token is stored.
    } finally {
      setAccount(null);
      setMatches([]);
      setState("signed-out");
      await logout({ logoutParams: { returnTo: fixedLoginReturnUri() } });
    }
  }, [accessToken, config.apiBaseUrl, isAuthenticated, logout]);

  const value = useMemo<AccountContextValue>(
    () => ({ state, enabled: true, account, matches, error, signIn, signOut, refreshMatches }),
    [account, error, matches, refreshMatches, signIn, signOut, state],
  );
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const config = browserAuthConfig();
  if (!config) return <AccountContext.Provider value={disabledValue}>{children}</AccountContext.Provider>;
  return (
    <Auth0Provider
      domain={config.domain}
      clientId={config.clientId}
      cacheLocation="memory"
      useRefreshTokens
      useRefreshTokensFallback={false}
      authorizationParams={{ audience: config.audience, redirect_uri: fixedLoginReturnUri() }}
    >
      <AccountBridge config={config}>{children}</AccountBridge>
    </Auth0Provider>
  );
}
