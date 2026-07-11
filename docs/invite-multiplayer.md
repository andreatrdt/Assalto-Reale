# Invite-based multiplayer

## Roadmap position

Phase C.9 is complete at the code and validation level.

```text
Phase C.8 Authoritative server        completed
Phase C.9 Invite multiplayer          completed
  C.9.1 Online client foundation      completed
  C.9.2 Host/join experience          completed
  C.9.3 Authoritative gameplay UI     completed
Phase C.10 Accounts/continuity        next
Phase C.11 Timed online matches       pending
Backend deployment                    still required
```

C.9 connects the React client to the authoritative HTTP/WebSocket backend for
anonymous, invite-only, untimed matches. Local Human-v-Human and
Human-v-Computer modes remain unchanged.

## User flow

1. The player opens **Play Online**.
2. The browser obtains a short-lived anonymous guest credential from
   `POST /session`.
3. The client opens the configured WebSocket with that signed credential.
4. A host creates a private match and shares the returned invite code.
5. The second player joins with that code.
6. Both clients render the canonical snapshots emitted by the server.
7. Disconnects trigger exponential reconnect followed by `RequestSync`.

## Authority contract

The browser never becomes a second rules engine for online state. It may compute
selection highlights for presentation, but every placement, move, decision, pass
and resignation is sent as a versioned protocol command. The board changes only
after a canonical server envelope is received.

Online mode temporarily replaces the existing board actions with a dedicated
action bridge. Local undo, save/load, import/export and local restart are blocked
for online matches. Starting a local match restores the original store actions.

## Anonymous guest sessions

`HmacGuestSessionService` issues short-lived signed credentials containing a
player ID, session ID and expiry. `GuestSessionConnectionAuthenticator` accepts
the token through the browser-compatible `access_token` WebSocket query parameter
or an HTTP Bearer header.

These credentials are not accounts. They are stored in browser session storage
and provide reconnect continuity only within that browser session. Cross-device
identity and durable ownership remain Phase C.10.

## Configuration

The web build requires:

```text
VITE_MULTIPLAYER_WS_URL=wss://multiplayer.example/ws
```

By default the browser derives the guest-session endpoint from the WebSocket URL
as `https://multiplayer.example/session`. It can be overridden with:

```text
VITE_MULTIPLAYER_SESSION_URL=https://api.example/session
```

Without `VITE_MULTIPLAYER_WS_URL`, the visible online page fails closed, shows
**Server not configured**, and disables host/join actions.

The transport process must configure the same allowed web origin for HTTP session
bootstrap and WebSocket upgrades.

## Delivered UX

- Home-page **Play Online** and **Resume Online Match** entry points;
- private host and join-by-code cards;
- shareable invite-code waiting room;
- connected, reconnecting, offline and error states;
- canonical board synchronization and server version display;
- pending-command feedback and structured rejection messages;
- side/turn ownership enforcement;
- online resignation confirmation;
- responsive desktop and mobile layouts.

## Validation

C.9 adds focused coverage for:

- guest credential storage, acquisition and URL derivation;
- WebSocket connection, command serialization, reconnect and `RequestSync`;
- online store event reduction and command dispatch;
- canonical snapshot projection;
- local/online action-boundary restoration;
- guest-token signing, expiry, tamper rejection and HTTP bootstrap;
- visible Playwright online route and fail-closed unconfigured state.

The web suite contains 308 passing tests and retains the existing global coverage
thresholds. The authoritative/PostgreSQL and transport suites remain independent
and green.

## Deferred

- deployed backend infrastructure and TLS;
- production accounts and cross-device continuity;
- public matchmaking, ratings and spectators;
- rematch implementation;
- server-authoritative clocks and timed online play.

## Running the backend (Phase C.9.5)

The composed, runnable server lives in `packages/server-runtime`. Start the local
full stack with `docker compose up --build` and point the client at it with
`VITE_MULTIPLAYER_WS_URL`. See [`multiplayer-deployment.md`](multiplayer-deployment.md)
for configuration, migrations, health/readiness, security assumptions and the
production checklist. The backend is runnable and container-buildable but not yet
publicly deployed.
