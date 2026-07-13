import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, type Env } from "../src/config.js";

const STRONG_SECRET = "0123456789abcdef0123456789abcdef01"; // 34 bytes
const DB = "postgresql://user:pass@db:5432/assalto";

function prodEnv(overrides: Env = {}): Env {
  return {
    NODE_ENV: "production",
    DATABASE_URL: DB,
    GUEST_SESSION_SECRET: STRONG_SECRET,
    MULTIPLAYER_ALLOWED_ORIGINS: "https://play.example.com",
    ...overrides,
  };
}

describe("runtime configuration", () => {
  it("loads a valid production configuration with no weak defaults", () => {
    const config = loadConfig(prodEnv());
    expect(config.mode).toBe("production");
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(8080);
    expect(config.databaseUrl).toBe(DB);
    expect(config.allowedOrigins).toEqual(["https://play.example.com"]);
    expect(config.websocketPath).toBe("/ws");
    expect(config.sessionPath).toBe("/session");
    expect(config.usingDevelopmentSecret).toBe(false);
    expect(config.guestSessionTtlMs).toBe(12 * 60 * 60 * 1000);
    expect(config.authEnabled).toBe(false);
  });

  it("provides safe, clearly-labelled development defaults", () => {
    const config = loadConfig({ DATABASE_URL: DB });
    expect(config.mode).toBe("development");
    expect(config.host).toBe("127.0.0.1");
    expect(config.usingDevelopmentSecret).toBe(true);
    expect(config.allowedOrigins).toContain("http://localhost:5173");
  });

  it("requires DATABASE_URL and rejects non-postgres URLs", () => {
    expect(() => loadConfig({ NODE_ENV: "development" })).toThrow(ConfigError);
    expect(() => loadConfig(prodEnv({ DATABASE_URL: "mysql://db/x" }))).toThrow(
      /postgres/,
    );
    expect(() => loadConfig(prodEnv({ DATABASE_URL: "not a url" }))).toThrow(
      /valid URL/,
    );
  });

  it("requires a strong secret and an origin allowlist in production", () => {
    expect(() =>
      loadConfig(prodEnv({ GUEST_SESSION_SECRET: undefined })),
    ).toThrow(/GUEST_SESSION_SECRET/);
    expect(() =>
      loadConfig(prodEnv({ GUEST_SESSION_SECRET: "short" })),
    ).toThrow(/at least 32/);
    expect(() =>
      loadConfig(prodEnv({ MULTIPLAYER_ALLOWED_ORIGINS: undefined })),
    ).toThrow(/MULTIPLAYER_ALLOWED_ORIGINS/);
    // An empty value is treated as absent (required); a non-empty value that
    // resolves to no origins fails with the "at least one origin" message.
    expect(() =>
      loadConfig(prodEnv({ MULTIPLAYER_ALLOWED_ORIGINS: "" })),
    ).toThrow(/MULTIPLAYER_ALLOWED_ORIGINS is required/);
    expect(() =>
      loadConfig(prodEnv({ MULTIPLAYER_ALLOWED_ORIGINS: " , " })),
    ).toThrow(/at least one origin/);
  });

  it("rejects the development placeholder secret in production", () => {
    const config = loadConfig({ DATABASE_URL: DB });
    expect(() =>
      loadConfig(prodEnv({ GUEST_SESSION_SECRET: config.guestSessionSecret })),
    ).toThrow(/placeholder/);
  });

  it("validates origins strictly (scheme, no path/query)", () => {
    expect(() =>
      loadConfig(prodEnv({ MULTIPLAYER_ALLOWED_ORIGINS: "https://a.com/app" })),
    ).toThrow(/must not include a path/);
    expect(() =>
      loadConfig(prodEnv({ MULTIPLAYER_ALLOWED_ORIGINS: "ftp://a.com" })),
    ).toThrow(/http or https/);
    const config = loadConfig(
      prodEnv({
        MULTIPLAYER_ALLOWED_ORIGINS:
          "https://a.com, https://a.com , https://b.com",
      }),
    );
    expect(config.allowedOrigins).toEqual(["https://a.com", "https://b.com"]);
  });

  it("validates ports, paths, TTLs and the fixed session path", () => {
    expect(() => loadConfig(prodEnv({ PORT: "0" }))).toThrow(
      /between 1 and 65535/,
    );
    expect(() => loadConfig(prodEnv({ PORT: "abc" }))).toThrow(/integer/);
    expect(() => loadConfig(prodEnv({ WEBSOCKET_PATH: "ws" }))).toThrow(
      /absolute path/,
    );
    expect(() => loadConfig(prodEnv({ SESSION_PATH: "/custom" }))).toThrow(
      /fixed at "\/session"/,
    );
    expect(() =>
      loadConfig(prodEnv({ GUEST_SESSION_TTL_SECONDS: "10" })),
    ).toThrow(/between/);
    expect(
      loadConfig(prodEnv({ GUEST_SESSION_TTL_SECONDS: "3600" }))
        .guestSessionTtlMs,
    ).toBe(3_600_000);
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => loadConfig(prodEnv({ NODE_ENV: "staging" }))).toThrow(
      /NODE_ENV/,
    );
  });

  it("validates the feature-gated OIDC account configuration", () => {
    const enabled = loadConfig(
      prodEnv({
        AUTH_ENABLED: "true",
        AUTH_ISSUER_URL: "https://tenant.example/",
        AUTH_AUDIENCE: "https://api.example/assalto",
        AUTH_SESSION_ID_CLAIM: "https://assalto.example/session_id",
        AUTH_WEBSOCKET_TICKET_TTL_SECONDS: "45",
      }),
    );
    expect(enabled.authEnabled).toBe(true);
    expect(enabled.authIssuerUrl).toBe("https://tenant.example/");
    expect(enabled.authWebsocketTicketTtlMs).toBe(45_000);
    expect(() => loadConfig(prodEnv({ AUTH_ENABLED: "true" }))).toThrow(
      /AUTH_ISSUER_URL/,
    );
    expect(() =>
      loadConfig(
        prodEnv({
          AUTH_ENABLED: "true",
          AUTH_ISSUER_URL: "http://tenant.example/",
          AUTH_AUDIENCE: "audience",
          AUTH_SESSION_ID_CLAIM: "sid",
        }),
      ),
    ).toThrow(/HTTPS/);
    expect(() => loadConfig(prodEnv({ AUTH_ENABLED: "sometimes" }))).toThrow(
      /must be "true" or "false"/,
    );
  });
});
