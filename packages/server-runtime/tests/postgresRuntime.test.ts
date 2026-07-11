import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createJsonLogger,
  createRuntime,
  loadConfig,
  type Runtime,
  type RuntimeConfig,
} from "../src/index.js";
import {
  QUICK_CONFIG,
  TEST_ORIGIN,
  TEST_SECRET,
  TestClient,
  acquireGuestSession,
  commandMessage,
} from "./support.js";

// Exercises the real composition root against a live PostgreSQL instance: config
// validation, pool, migrations, readiness, transport and canonical persistence.
// Runs when TEST_DATABASE_URL is set (the CI job provides a postgres service);
// skipped otherwise so local runs without a database stay green.
const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("composed runtime over PostgreSQL", () => {
  let runtime: Runtime;
  let baseUrl: string;
  let wsBase: string;

  beforeAll(async () => {
    // Bind an OS-assigned ephemeral port for the test. loadConfig deliberately
    // rejects PORT=0 (a real deployment must bind a known port, see config.ts /
    // config.test.ts), and start() returns the actually-bound address — so build
    // a fully-validated config and override only the listen port to 0.
    const config: RuntimeConfig = {
      ...loadConfig({
        NODE_ENV: "development",
        DATABASE_URL: databaseUrl,
        MULTIPLAYER_ALLOWED_ORIGINS: TEST_ORIGIN,
        GUEST_SESSION_SECRET: TEST_SECRET,
        HOST: "127.0.0.1",
      }),
      port: 0,
    };
    runtime = createRuntime(config, {
      logger: createJsonLogger({ write: () => undefined }),
    });
    const address = await runtime.start();
    baseUrl = `http://127.0.0.1:${address.port}`;
    wsBase = `ws://127.0.0.1:${address.port}${address.websocketPath}`;
  }, 30000);

  afterAll(async () => {
    await runtime?.stop();
  });

  it("migrates, serves readiness and persists a real two-player match", async () => {
    expect((await fetch(`${baseUrl}/readyz`)).status).toBe(200);

    const sessionA = await acquireGuestSession(baseUrl);
    const sessionB = await acquireGuestSession(baseUrl);
    const clientA = await TestClient.connect(wsBase, sessionA);

    clientA.send(
      commandMessage(sessionA, QUICK_CONFIG, { commandId: "cmd_pg_create01" }),
    );
    const created = await clientA.waitFor("MatchCreated");
    const matchId = created.matchId!;
    const inviteCode = (created.event as { inviteCode: string }).inviteCode;

    const clientB = await TestClient.connect(wsBase, sessionB);
    clientB.send(
      commandMessage(
        sessionB,
        { type: "JoinMatch", inviteCode },
        { commandId: "cmd_pg_join0001", matchId },
      ),
    );
    await clientB.waitFor("PlayerJoined");
    await clientA.waitFor("PlayerJoined");

    clientA.send(
      commandMessage(
        sessionA,
        { type: "PassTurn" },
        { commandId: "cmd_pg_pass0001", matchId, expectedMatchVersion: 2 },
      ),
    );
    const update = await clientB.waitFor("MatchUpdated");
    expect(update.matchVersion).toBe(3);

    // Reconnect + RequestSync recovers canonical state from PostgreSQL.
    await clientA.close();
    const clientA2 = await TestClient.connect(wsBase, sessionA);
    clientA2.send(
      commandMessage(
        sessionA,
        { type: "RequestSync", lastSeenMatchVersion: null },
        { commandId: "cmd_pg_sync0001", matchId },
      ),
    );
    const snapshot = await clientA2.waitFor("MatchSnapshot");
    expect(snapshot.matchVersion).toBe(3);
    expect(
      (snapshot.event as { snapshot: { schema: number } }).snapshot.schema,
    ).toBe(1);

    await clientB.close();
    await clientA2.close();
  }, 30000);
});
