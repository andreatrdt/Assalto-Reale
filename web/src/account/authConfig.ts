export interface BrowserAuthConfig {
  domain: string;
  clientId: string;
  audience: string;
  apiBaseUrl: string;
}

function configured(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value.trim();
}

export function browserAuthConfig(): BrowserAuthConfig | null {
  const domain = configured(import.meta.env.VITE_AUTH0_DOMAIN);
  const clientId = configured(import.meta.env.VITE_AUTH0_CLIENT_ID);
  const audience = configured(import.meta.env.VITE_AUTH0_AUDIENCE);
  const apiBaseUrl = configured(import.meta.env.VITE_ACCOUNT_API_URL);
  const values = [domain, clientId, audience, apiBaseUrl];
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) {
    throw new Error("Account authentication is only partially configured.");
  }
  return {
    domain: domain!.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    clientId: clientId!,
    audience: audience!,
    apiBaseUrl: apiBaseUrl!.replace(/\/$/, ""),
  };
}

export function fixedLoginReturnUri(): string {
  if (typeof window === "undefined") return "http://localhost/";
  return new URL(import.meta.env.BASE_URL || "/", window.location.origin).toString();
}
