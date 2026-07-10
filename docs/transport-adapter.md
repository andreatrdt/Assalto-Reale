# Authoritative transport adapter

## Roadmap position

This document defines Phase C.8.3 of the Assalto Reale roadmap.

```text
Phase C.8 Authoritative server
  C.8.1 Application core              completed
  C.8.2 PostgreSQL adapter            completed
  C.8.3 Transport adapter             in progress
Phase C.9 Invite multiplayer          pending
```

The transport layer is intentionally thin. It authenticates a WebSocket connection, binds the resulting principal to `CommandHandler`, forwards decoded command payloads, and delivers the returned canonical protocol envelopes. It does not implement gameplay rules, membership, idempotency, optimistic concurrency, persistence, or account logic.

Planned C.8.3 scope:

- HTTP `/healthz` and `/readyz` endpoints;
- authenticated WebSocket upgrade on a configurable path;
- per-connection command serialization;
- principal propagation through an async context authenticator;
- match and player recipient routing;
- reconnect-safe subscription through successful canonical events;
- origin filtering, payload limits, heartbeat cleanup, and graceful shutdown;
- integration tests using real WebSocket clients.

Production identity providers, deployed infrastructure, accounts, invite UI, matchmaking, and clocks remain outside this phase.
