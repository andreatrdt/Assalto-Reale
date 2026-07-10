import assert from "node:assert/strict";
import {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  decodeClientMessage,
  encodeClientMessage,
} from "../../packages/multiplayer-protocol/dist/index.js";

const message = {
  protocol: PROTOCOL_NAME,
  protocolVersion: PROTOCOL_VERSION,
  messageType: "command",
  commandId: "command_01HZY8R7",
  sentAt: "2026-07-10T12:00:00.000Z",
  actor: {
    playerId: "player_01HZY8R7",
    sessionId: "session_01HZY8R7",
  },
  matchId: "match_01HZY8R7",
  expectedMatchVersion: 3,
  command: {
    type: "SubmitAction",
    start: [5, 5],
    end: [5, 6],
  },
};

const encoded = encodeClientMessage(message);
const decoded = decodeClientMessage(encoded);
assert.equal(decoded.ok, true);
if (!decoded.ok) throw new Error(decoded.error.message);
assert.deepEqual(decoded.value, message);

console.log("multiplayer-protocol package smoke passed");
