export interface GuestSessionCredentials {
  token: string;
  playerId: string;
  sessionId: string;
  expiresAt: string;
  authKind?: "guest" | "registered";
}

export type OnlineSessionCredentials = GuestSessionCredentials;
export type RegisteredSessionProvider = (websocketUrl: string, matchId: string | null) => Promise<OnlineSessionCredentials>;

let registeredSessionProvider: RegisteredSessionProvider | null = null;

export function setRegisteredSessionProvider(provider: RegisteredSessionProvider | null): void {
  registeredSessionProvider = provider;
}

const SESSION_STORAGE_KEY = "assalto:online-guest-session";

function isCredentials(value: unknown): value is GuestSessionCredentials {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.token === "string" &&
    candidate.token.length > 0 &&
    typeof candidate.playerId === "string" &&
    candidate.playerId.length > 0 &&
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    typeof candidate.expiresAt === "string" &&
    Number.isFinite(Date.parse(candidate.expiresAt))
  );
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadGuestSession(now = Date.now()): GuestSessionCredentials | null {
  const target = storage();
  if (!target) return null;
  try {
    const raw = target.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isCredentials(parsed) || Date.parse(parsed.expiresAt) <= now + 30_000) {
      target.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveGuestSession(credentials: GuestSessionCredentials): void {
  const target = storage();
  if (!target) return;
  try {
    target.setItem(SESSION_STORAGE_KEY, JSON.stringify(credentials));
  } catch {
    // Online play remains usable for the current page even if storage is blocked.
  }
}

export function clearGuestSession(): void {
  const target = storage();
  if (!target) return;
  try {
    target.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage-denied environments.
  }
}

export function configuredWebSocketUrl(): string | null {
  const configured = import.meta.env.VITE_MULTIPLAYER_WS_URL;
  return typeof configured === "string" && configured.trim().length > 0 ? configured.trim() : null;
}

export function sessionEndpointFor(websocketUrl: string): string {
  const configured = import.meta.env.VITE_MULTIPLAYER_SESSION_URL;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured.trim();
  }
  const url = new URL(websocketUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/session";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function acquireGuestSession(websocketUrl: string, fetcher: typeof fetch = fetch): Promise<GuestSessionCredentials> {
  const cached = loadGuestSession();
  if (cached) return cached;

  const response = await fetcher(sessionEndpointFor(websocketUrl), {
    method: "POST",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Could not create an online guest session (${response.status}).`);
  }
  const payload = (await response.json()) as unknown;
  if (!isCredentials(payload)) {
    throw new Error("The multiplayer server returned an invalid guest session.");
  }
  saveGuestSession(payload);
  return payload;
}

export function acquireOnlineSession(websocketUrl: string, matchId: string | null): Promise<OnlineSessionCredentials> {
  return registeredSessionProvider ? registeredSessionProvider(websocketUrl, matchId) : acquireGuestSession(websocketUrl);
}

export function authenticatedWebSocketUrl(websocketUrl: string, token: string, authKind: "guest" | "registered" = "guest"): string {
  const url = new URL(websocketUrl);
  url.searchParams.set(authKind === "registered" ? "ticket" : "access_token", token);
  return url.toString();
}
