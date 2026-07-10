# Authoritative transport adapter

## Roadmap position

This document defines the completed Phase C.8.3 of the Assalto Reale roadmap.

```text
Phase C.8 Authoritative server
  C.8.1 Application core              completed
  C.8.2 PostgreSQL adapter            completed
  C.8.3 Transport adapter             completed
Phase C.9 Invite multiplayer          next
```

The transport layer is intentionally thin. It authenticates a WebSocket connection, binds the resulting principal to `CommandHandler`, forwards command payloads, and delivers returned canonical protocol envelopes. It does not implement gameplay rules, membership, idempotency, optimistic concurrency, persistence, or account logic.

## Package boundary

`packages/server-transport` depends only on:

- the public `@assalto-reale/authoritative-server` API;
- the public `@assalto-reale/multiplayer-protocol` API;
- Node HTTP/runtime modules;
- `ws` as the WebSocket implementation.

It may not import `game-core`, PostgreSQL, React, Zustand, the web application, Socket.IO, or an identity-provider SDK. Architecture tests enforce this boundary.

## HTTP endpoints

The adapter exposes:

- `GET` or `HEAD /healthz` for process liveness;
- `GET` or `HEAD /readyz` for an injected dependency-readiness probe;
- an authenticated WebSocket upgrade endpoint, `/ws` by default.

Health responses are JSON, non-cacheable, and contain no operational secrets. Readiness fails closed when the injected probe returns false or throws.

## Authentication bridge

`ConnectionAuthenticator` authenticates the HTTP upgrade and returns an `AuthenticatedPrincipal`. The provider-neutral `BearerTokenConnectionAuthenticator` parses a bearer token but delegates token verification to an injected verifier; C.8.3 does not choose an identity provider or account model.

`ContextualAuthenticator` carries the connection principal into the existing application-core `Authenticator` port through `AsyncLocalStorage`. `CommandHandler` still compares that authenticated principal with the command envelope actor, so clients cannot gain authority by editing JSON identity fields.

## Command and delivery flow

```text
HTTP upgrade
  -> authenticate connection
  -> accept WebSocket
  -> parse one text message
  -> execute as connection principal
  -> CommandHandler.handle
  -> receive canonical ServerEventEnvelope[]
  -> route by recipient and match subscription
```

Commands from one connection are serialized to preserve arrival order. Binary client messages are rejected. Malformed JSON is still passed to `CommandHandler`, which returns the protocol's canonical structured rejection rather than a transport-specific payload.

Successful canonical match events subscribe the originating connection to that match. Events addressed to `all` are delivered to every subscribed socket for the match. Player-addressed events are delivered to every live socket authenticated as that player, enabling reconnect and multiple-session continuity without moving membership logic into the transport.

## Operational safeguards

The adapter provides configurable:

- origin allowlisting;
- inbound payload limits;
- outbound backpressure limits;
- ping/pong heartbeat cleanup;
- WebSocket path;
- graceful-shutdown deadline;
- structured logging;
- readiness checks.

Shutdown is idempotent: clients receive a normal going-away close before any remaining sockets are force-terminated after the grace period.

## Validation

The permanent server CI runs transport validation independently of PostgreSQL:

- strict TypeScript typecheck;
- architecture lint;
- Prettier check;
- HTTP and real-WebSocket integration tests with coverage thresholds;
- ESM build and plain-Node smoke;
- production dependency audit.

Integration coverage includes health/readiness behavior, upgrade authentication, origin rejection, invalid JSON, actor spoofing, match creation and joining, reconnect synchronization, match broadcasts, per-connection command ordering, binary-message rejection, and graceful shutdown.

## Deferred work

Production identity providers, accounts, client invite screens, deployment infrastructure, matchmaking, ratings, and server-authoritative clocks remain outside C.8.3. Phase C.9 connects this completed server stack to invite-based untimed multiplayer in the web client.
