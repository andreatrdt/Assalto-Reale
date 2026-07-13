import { Auth0Provider, useAuth0, type AppState } from "@auth0/auth0-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { navigateTo } from "../app/routes";
import { clearGuestSession, loadGuestSession, setRegisteredSessionProvider } from "../online/onlineIdentity";
import { useOnlineMatchStore } from "../online/onlineStore";
import { AccountApiError, accountApi, type AccountSummary, type ActiveAccountMatch } from "./accountApi";
import { AccountSessionHydrator, restoreAccountSession } from "./accountSessionHydration";
import { browserAuthConfig, fixedLoginReturnUri, safeAuthReturnRoute, type BrowserAuthConfig } from "./authConfig";

export type AccountState = "checking-session" | "guest" | "signing-in" | "signed-in" | "auth-failed" | "session-expired" | "signed-out";

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

function handleRedirectCallback(appState?: AppState): void {
  navigateTo(safeAuthReturnRoute(appState?.returnTo), true);
}

function AccountBridge({ config, children }: { config: BrowserAuthConfig; children: ReactNode }) {
  const { error: providerError, getAccessTokenSilently, isLoading, loginWithRedirect, logout } = useAuth0();
  const [state, setState] = useState<AccountState>("checking-session");
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [matches, setMatches] = useState<ActiveAccountMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const hydrationGeneration = useRef(0);
  const hydrationApplied = useRef(false);
  const hydrator = useRef<AccountSessionHydrator | null>(null);
  const accessTokenRef = useRef<() => Promise<string>>(async () => {
    throw new Error("The authentication provider is not ready.");
  });

  const accessToken = useCallback(
    () => getAccessTokenSilently({ authorizationParams: { audience: config.audience } }),
    [config.audience, getAccessTokenSilently],
  );
  accessTokenRef.current = accessToken;

  const refreshMatches = useCallback(async () => {
    if (!account) return;
    try {
      setMatches(await accountApi.matches(config.apiBaseUrl, await accessToken()));
    } catch (reason) {
      if (reason instanceof AccountApiError && reason.status === 401) {
        setRegisteredSessionProvider(null);
        setAccount(null);
        setMatches([]);
        setState("session-expired");
        setError("Your account session has expired or ended. Sign in again.");
      } else {
        setError("Could not load active matches.");
      }
    }
  }, [accessToken, account, config.apiBaseUrl]);

  useEffect(() => {
    if (isLoading) {
      setState("checking-session");
      return;
    }
    if (providerError) {
      hydrationGeneration.current += 1;
      setState("auth-failed");
      setError("Sign-in could not be completed. Try again.");
      return;
    }

    hydrator.current ??= new AccountSessionHydrator(() =>
      restoreAccountSession({
        apiBaseUrl: config.apiBaseUrl,
        getAccessToken: () => accessTokenRef.current(),
        guestSession: loadGuestSession(),
      }),
    );
    const generation = hydrationGeneration.current;
    void hydrator.current.hydrate().then((result) => {
      if (hydrationApplied.current || generation !== hydrationGeneration.current) return;
      hydrationApplied.current = true;
      if (result.state === "signed-in") {
        if (result.upgradedGuest) {
          clearGuestSession();
        }
        setRegisteredSessionProvider(result.ticketProvider);
        useOnlineMatchStore.getState().disconnect(true);
        setAccount(result.account);
        setMatches(result.matches);
        setError(null);
        setState("signed-in");
        return;
      }
      setRegisteredSessionProvider(null);
      setAccount(null);
      setMatches([]);
      setError(result.error);
      setState(result.state);
    });
  }, [config.apiBaseUrl, isLoading, providerError]);

  const signIn = useCallback(async () => {
    setState("signing-in");
    setError(null);
    try {
      await loginWithRedirect({ appState: { returnTo: "/account" } });
    } catch {
      setState("auth-failed");
      setError("Sign-in could not be started. Try again.");
    }
  }, [loginWithRedirect]);

  const signOut = useCallback(async () => {
    hydrationGeneration.current += 1;
    setRegisteredSessionProvider(null);
    useOnlineMatchStore.getState().disconnect(false);
    clearGuestSession();
    try {
      if (account) await accountApi.logout(config.apiBaseUrl, await accessToken());
    } catch {
      // Provider logout still runs when the backend is temporarily unreachable.
      // The local ticket source is already disabled and no app token is stored.
    } finally {
      setAccount(null);
      setMatches([]);
      setState("signed-out");
      await logout({ logoutParams: { returnTo: fixedLoginReturnUri() } });
    }
  }, [accessToken, account, config.apiBaseUrl, logout]);

  const value = useMemo<AccountContextValue>(
    () => ({ state, enabled: true, account, matches, error, signIn, signOut, refreshMatches }),
    [account, error, matches, refreshMatches, signIn, signOut, state],
  );
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const config = browserAuthConfig();
  if (!config) return <AccountContext.Provider value={disabledValue}>{children}</AccountContext.Provider>;
  // Tokens stay memory-only. After a reload the refresh token is gone, so the
  // SDK must be allowed to fall back to its silent authorize iframe.
  return (
    <Auth0Provider
      domain={config.domain}
      clientId={config.clientId}
      cacheLocation="memory"
      useRefreshTokens
      useRefreshTokensFallback
      authorizationParams={{ audience: config.audience, redirect_uri: fixedLoginReturnUri() }}
      onRedirectCallback={handleRedirectCallback}
    >
      <AccountBridge config={config}>{children}</AccountBridge>
    </Auth0Provider>
  );
}
