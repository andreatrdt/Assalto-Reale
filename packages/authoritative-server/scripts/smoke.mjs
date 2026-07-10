import { CommandHandler, createInMemoryPersistence } from "../dist/index.js";

const persistence = createInMemoryPersistence();
let eventCounter = 0;
const handler = new CommandHandler({
  matches: persistence.matches,
  unitOfWork: persistence.unitOfWork,
  authenticator: {
    async authenticate(envelope) {
      return { playerId: envelope.actor.playerId, sessionId: envelope.actor.sessionId };
    },
  },
  clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
  ids: {
    matchId: () => "match_smoke01",
    inviteCode: () => "SMOKE001",
    eventId: () => `event_smoke${String(++eventCounter).padStart(2, "0")}`,
  },
  seeds: { next: () => 424242 },
});

const events = await handler.handle({
  protocol: "assalto-reale",
  protocolVersion: 1,
  messageType: "command",
  commandId: "cmd_smoke001",
  sentAt: "2026-01-01T00:00:00.000Z",
  actor: { playerId: "player_smoke1", sessionId: "session_smoke1" },
  matchId: null,
  expectedMatchVersion: null,
  command: {
    type: "CreateMatch",
    config: {
      visibility: "invite",
      placementMode: "QuickBalanced",
      transformEnabled: true,
      preferredSide: "Black",
      timeControl: { kind: "untimed" },
    },
  },
});

if (events.length !== 1 || events[0]?.event.type !== "MatchCreated") {
  throw new Error("Authoritative server smoke did not create a match.");
}
const aggregate = persistence.store.matches.get("match_smoke01");
if (!aggregate || aggregate.seed !== 424242 || aggregate.version !== 1) {
  throw new Error("Authoritative server did not persist canonical server-owned state.");
}

console.log("authoritative-server Node smoke passed");
