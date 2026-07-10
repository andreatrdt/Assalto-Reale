# Invite multiplayer client

## Roadmap position

```text
Phase C.8 Authoritative server       completed
Phase C.9 Invite multiplayer         in progress
  C.9.1 Online client foundation     in progress
  C.9.2 Host/join interface          pending
  C.9.3 Gameplay integration         pending
Phase C.10 Accounts/continuity       pending
Phase C.11 Timed online matches      pending
```

Phase C.9 connects the existing React client to the authoritative HTTP/WebSocket backend for invite-only, untimed matches. Existing local Human-v-Human and Human-v-Computer modes remain unchanged.

The client is a projection of canonical server state. It may create command envelopes, display optimistic pending UI, and request synchronization, but it must not decide match legality, membership, turn ownership, canonical versions, or final board state.

Planned scope:

- browser WebSocket client with protocol validation;
- online session store and connection lifecycle;
- reconnect with canonical `RequestSync`;
- host and join-by-code screens;
- invite-code waiting room;
- canonical snapshot projection into the existing board UI;
- pending-command and structured rejection UX;
- online resignation and terminal match flow;
- unit, integration and browser coverage.

Production accounts, identity-provider UI, public matchmaking, ratings, rematches and timed online matches remain outside this phase.
