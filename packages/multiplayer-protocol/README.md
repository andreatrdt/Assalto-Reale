# @assalto-reale/multiplayer-protocol

Transport-independent, versioned JSON protocol for authoritative Assalto Reale multiplayer.

The package defines and validates:

- client command envelopes;
- server event envelopes;
- command idempotency keys;
- optimistic match-version checks;
- player/session identity;
- invite, action, pending-decision, resignation, rematch and sync messages;
- structured command rejections;
- JSON codecs.

It does not implement networking, authentication, persistence, clocks or game rules. Authentication credentials belong to the transport layer; the server maps the authenticated principal to `actor.playerId` and rejects mismatches.

```ts
const message: ClientCommandEnvelope = {
  protocol: "assalto-reale",
  protocolVersion: 1,
  messageType: "command",
  commandId: "cmd_01HZY8R7V8",
  sentAt: new Date().toISOString(),
  actor: {
    playerId: "player_01HZY8R7",
    sessionId: "session_01HZY8R7"
  },
  matchId: "match_01HZY8R7",
  expectedMatchVersion: 12,
  command: {
    type: "SubmitAction",
    start: [5, 5],
    end: [5, 6]
  }
};
```
