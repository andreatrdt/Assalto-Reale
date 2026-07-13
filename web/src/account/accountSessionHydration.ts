import type { GuestSessionCredentials, RegisteredSessionProvider } from "../online/onlineIdentity";
import { AccountApiError, accountApi, type AccountSummary, type ActiveAccountMatch } from "./accountApi";

interface AccountSessionApi {
  establish(baseUrl: string, accessToken: string): Promise<AccountSummary>;
  upgradeGuest(baseUrl: string, accessToken: string, guestToken: string): Promise<AccountSummary>;
  matches(baseUrl: string, accessToken: string): Promise<ActiveAccountMatch[]>;
  websocketTicket(
    baseUrl: string,
    accessToken: string,
    matchId: string | null,
  ): Promise<{ ticket: string; playerId: string; sessionId: string; expiresAt: string }>;
}

export type AccountHydrationResult =
  | {
      state: "signed-in";
      account: AccountSummary;
      matches: ActiveAccountMatch[];
      ticketProvider: RegisteredSessionProvider;
      upgradedGuest: boolean;
      error: null;
    }
  | {
      state: "guest" | "auth-failed" | "session-expired";
      account: null;
      matches: [];
      ticketProvider: null;
      upgradedGuest: false;
      error: string | null;
    };

interface RestoreAccountSessionOptions {
  apiBaseUrl: string;
  getAccessToken(): Promise<string>;
  guestSession: GuestSessionCredentials | null;
  api?: AccountSessionApi;
}

function providerErrorCode(reason: unknown): string | null {
  if (!reason || typeof reason !== "object" || !("error" in reason)) return null;
  return typeof reason.error === "string" ? reason.error : null;
}

/**
 * login_required is the provider's explicit signal that no SSO session exists.
 * Other silent-auth failures stay visible instead of impersonating sign-out.
 */
export function isMissingProviderSession(reason: unknown): boolean {
  return providerErrorCode(reason) === "login_required";
}

export async function restoreAccountSession({
  apiBaseUrl,
  getAccessToken,
  guestSession,
  api = accountApi,
}: RestoreAccountSessionOptions): Promise<AccountHydrationResult> {
  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (reason) {
    if (isMissingProviderSession(reason)) {
      return {
        state: "guest",
        account: null,
        matches: [],
        ticketProvider: null,
        upgradedGuest: false,
        error: null,
      };
    }
    return {
      state: "auth-failed",
      account: null,
      matches: [],
      ticketProvider: null,
      upgradedGuest: false,
      error: "Your account session could not be checked. Sign in to try again.",
    };
  }

  try {
    let current = await api.establish(apiBaseUrl, accessToken);
    if (guestSession) {
      current = await api.upgradeGuest(apiBaseUrl, accessToken, guestSession.token);
    }
    const matches = await api.matches(apiBaseUrl, accessToken);
    const ticketProvider: RegisteredSessionProvider = async (_websocketUrl, matchId) => {
      const ticket = await api.websocketTicket(apiBaseUrl, await getAccessToken(), matchId);
      return { ...ticket, token: ticket.ticket, authKind: "registered" };
    };
    return {
      state: "signed-in",
      account: current,
      matches,
      ticketProvider,
      upgradedGuest: guestSession !== null,
      error: null,
    };
  } catch (reason) {
    if (reason instanceof AccountApiError && reason.status === 401) {
      return {
        state: "session-expired",
        account: null,
        matches: [],
        ticketProvider: null,
        upgradedGuest: false,
        error: "Your account session has expired or ended. Sign in again.",
      };
    }
    return {
      state: "auth-failed",
      account: null,
      matches: [],
      ticketProvider: null,
      upgradedGuest: false,
      error: "Your account could not be restored. Sign in to try again.",
    };
  }
}

/** Memoizes the first result so rerenders and failures cannot create a silent-auth loop. */
export class AccountSessionHydrator {
  private attempt: Promise<AccountHydrationResult> | null = null;

  constructor(private readonly restore: () => Promise<AccountHydrationResult>) {}

  hydrate(): Promise<AccountHydrationResult> {
    this.attempt ??= this.restore();
    return this.attempt;
  }
}
