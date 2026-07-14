export interface AccountSummary {
  kind: "registered";
  user: { userId: string; status: "active"; email: string | null };
  playerId: string;
  sessionId: string;
  expiresAt: string;
}

export interface ActiveAccountMatch {
  matchId: string;
  side: "Black" | "White";
  status: "awaitingOpponent" | "active";
  updatedAt: string;
}

export class AccountApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AccountApiError";
  }
}

async function request<T>(apiBaseUrl: string, path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new AccountApiError(
      response.status,
      typeof payload.code === "string" ? payload.code : "request_failed",
      typeof payload.message === "string" ? payload.message : "The account request failed.",
    );
  }
  return payload as T;
}

export const accountApi = {
  establish: (base: string, token: string) => request<AccountSummary>(base, "/session", token, { method: "POST" }),
  upgradeGuest: (base: string, token: string, guestToken: string) =>
    request<AccountSummary>(base, "/upgrade-guest", token, {
      method: "POST",
      body: JSON.stringify({ guestToken }),
    }),
  matches: async (base: string, token: string) => (await request<{ matches: ActiveAccountMatch[] }>(base, "/matches", token)).matches,
  history: (base: string, token: string, query = "") =>
    request<MatchHistoryPage>(base, `/matches/history${query ? `?${query}` : ""}`, token),
  historyDetails: (base: string, token: string, matchId: string) =>
    request<MatchHistoryDetails>(base, `/matches/history/${encodeURIComponent(matchId)}`, token),
  statistics: (base: string, token: string) => request<PlayerStatisticsSummary>(base, "/statistics", token),
  logout: (base: string, token: string) => request<Record<string, never>>(base, "/logout", token, { method: "POST" }),
  websocketTicket: (base: string, token: string, matchId: string | null) =>
    request<{
      ticket: string;
      playerId: string;
      sessionId: string;
      expiresAt: string;
    }>(base, "/websocket-ticket", token, {
      method: "POST",
      body: JSON.stringify(matchId ? { matchId } : {}),
    }),
};
import type { MatchHistoryDetails, MatchHistoryPage, PlayerStatisticsSummary } from "../online/protocol";
