import { afterEach, describe, expect, it, vi } from "vitest";
import { browserAuthConfig, safeAuthReturnRoute } from "./authConfig";

afterEach(() => vi.unstubAllEnvs());

describe("browser account configuration", () => {
  it("keeps guest mode when all public account values are absent", () => {
    vi.stubEnv("VITE_AUTH0_DOMAIN", "");
    vi.stubEnv("VITE_AUTH0_CLIENT_ID", "");
    vi.stubEnv("VITE_AUTH0_AUDIENCE", "");
    vi.stubEnv("VITE_ACCOUNT_API_URL", "");
    expect(browserAuthConfig()).toBeNull();
  });

  it("fails closed for partial configuration and accepts a complete public SPA config", () => {
    vi.stubEnv("VITE_AUTH0_DOMAIN", "tenant.example");
    expect(() => browserAuthConfig()).toThrow(/partially configured/);
    vi.stubEnv("VITE_AUTH0_CLIENT_ID", "public-client-id");
    vi.stubEnv("VITE_AUTH0_AUDIENCE", "https://api.example");
    vi.stubEnv("VITE_ACCOUNT_API_URL", "https://backend.example/auth/");
    expect(browserAuthConfig()).toEqual({
      domain: "tenant.example",
      clientId: "public-client-id",
      audience: "https://api.example",
      apiBaseUrl: "https://backend.example/auth",
    });
  });

  it("allows only known local callback routes", () => {
    expect(safeAuthReturnRoute("/account")).toBe("/account");
    expect(safeAuthReturnRoute("https://attacker.example/redirect")).toBe("/");
    expect(safeAuthReturnRoute(undefined)).toBe("/");
  });
});
