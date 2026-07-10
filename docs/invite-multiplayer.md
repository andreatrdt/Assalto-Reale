# Invite-based multiplayer

## Roadmap position

This document defines Phase C.9 of the Assalto Reale roadmap.

```text
Phase C.8 Authoritative server       completed
Phase C.9 Invite multiplayer          in progress
  C.9.1 Online client foundation      in progress
  C.9.2 Host/join experience          pending
  C.9.3 Authoritative gameplay UI     pending
Phase C.10 Accounts/continuity        pending
Phase C.11 Timed online matches       pending
```

C.9 connects the existing React client to the authoritative HTTP/WebSocket backend for anonymous, invite-only, untimed matches. Local Human-v-Human and Human-v-Computer modes remain unchanged.

The client must never become a second gameplay authority. It sends versioned commands, renders canonical snapshots returned by the server, and exposes connection, turn ownership, pending-command and rejection state.

Planned scope:

- persistent anonymous player and session identifiers;
- configurable WebSocket endpoint and bearer token;
- connection lifecycle with reconnect and canonical `RequestSync`;
- host flow that creates an invite-only untimed match;
- join flow using an invite code;
- lobby state while waiting for the second player;
- canonical snapshot projection into the existing board UI;
- online command dispatch for placement, movement, decisions, pass and resignation;
- visible connected, reconnecting, offline and rejected states;
- integration and browser tests that keep every local mode unchanged.

Production accounts, cross-device identity continuity, public matchmaking, ratings, spectators and timed online play remain outside C.9.