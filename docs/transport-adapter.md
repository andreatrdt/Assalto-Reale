# Authoritative transport adapter

## Roadmap position

Phase C.8.3 delivered the transport boundary; Phase C.9 now consumes and extends
that boundary with anonymous guest-session bootstrap.

```text
Phase C.8 Authoritative server
  C.8.1 Application core              completed
  C.8.2 PostgreSQL adapter            completed
  C.8.3 Transport adapter             completed
Phase C.9 Invite multiplayer          completed
Phase C.10 Accounts/continuity        next
```

The transport remains intentionally thin. It authenticates HTTP/WebSocket
connections, binds the principal to `CommandHandler`, forwards command payloads
and delivers canonical protocol envelopes. It does not implement gameplay rules,
membership, idempotency, optimistic concurrency or persistence.

## Package boundary

`packages/server-transport` depends only on:

- the public `@assalto-reale/authoritative-server` API;
- the public `@assalto-reale/multiplayer-protocol` API;
- Node HTTP/runtime modules;
- `ws` as the WebSocket implementation.

It may not import `game-core`, PostgreSQL, React, Zustand, the web app, Socket.IO
or an identity-provider SDK. Architecture tests enforce this boundary.

## HTTP endpoints

The adapter exposes:

- `GET`/`HEAD /healthz` for process liveness;
- `GET`/`HEAD /readyz` for injected dependency readiness;
- optional `POST /session` for a short-lived anonymous guest credential;
- optional `OPTIONS /session` for CORS preflight;
- authenticated WebSocket upgrade on `/ws` by default.

Health/session responses are JSON and non-cacheable. Readiness fails closed when
the probe returns false or throws. `/session` returns 404 unless a
`GuestSessionIssuer` is configured.

## Authentication bridge

`ConnectionAuthenticator` authenticates the upgrade and returns an
`AuthenticatedPrincipal`. `ContextualAuthenticator` carries that principal into
the application-core `Authenticator` port through `AsyncLocalStorage`.
`CommandHandler` still compares the principal with the command envelope actor.

The provider-neutral `BearerTokenConnectionAuthenticator` delegates verification
to an injected verifier.

For C.9, `HmacGuestSessionService` issues expiring signed credentials and
`GuestSessionConnectionAuthenticator` accepts a Bearer token or the browser
`access_token` query parameter. Token verification rejects malformed, expired and
tampered values. Guest sessions remain distinct from durable accounts.

## Command and delivery flow

```text
HTTP guest bootstrap (optional)
  -> issue signed principal

HTTP upgrade
  -> authenticate connection
  -> accept WebSocket
  -> parse one text message
  -> execute as connection principal
  -> CommandHandler.handle
  -> receive canonical ServerEventEnvelope[]
  -> route by recipient and match subscription
```

Commands from one connection are serialized. Binary messages are rejected.
Malformed JSON reaches `CommandHandler`, which returns the protocol's canonical
structured rejection instead of a transport-specific payload.

Successful match events subscribe the originating connection to that match.
`recipient: all` events go to every subscribed socket; player-addressed events go
to every live socket for that player. This supports reconnect and multiple live
sessions without moving membership into transport.

## Operational safeguards

The adapter provides configurable origin allowlisting, inbound payload limits,
outbound backpressure limits, heartbeat cleanup, WebSocket path, structured
logging, readiness and graceful-shutdown deadline.

The origin allowlist applies to both browser guest-session bootstrap and WebSocket
upgrades. Shutdown is idempotent: clients receive a going-away close before any
remaining sockets are force-terminated after the grace period.

## Validation

Permanent CI verifies:

- strict TypeScript and architecture boundaries;
- Prettier;
- HTTP and real-WebSocket integration coverage;
- health/readiness and browser guest bootstrap;
- token signing, expiry and tamper rejection;
- upgrade authentication and origin rejection;
- invalid JSON, actor spoofing and binary rejection;
- match creation/joining, reconnect sync and broadcasts;
- per-connection command ordering and graceful shutdown;
- ESM smoke and production dependency audit.

## Deferred work

Backend deployment, production accounts, cross-device identity, public
matchmaking, ratings, spectators, rematches and server-authoritative clocks remain
outside the transport adapter.
