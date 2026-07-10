# @assalto-reale/server-transport

Thin HTTP/WebSocket edge for the Assalto Reale authoritative server.

The package owns connection authentication, WebSocket lifecycle, message ordering and event delivery. It delegates every command to the C.8.1 `CommandHandler`; PostgreSQL persistence remains in the C.8.2 adapter. The transport never reimplements game rules, membership, command idempotency or version checks.

## Endpoints

- `GET /healthz` — process liveness;
- `GET /readyz` — injected dependency readiness;
- WebSocket `/ws` by default — versioned multiplayer-protocol command/event channel.

## Authentication boundary

`ConnectionAuthenticator` authenticates the HTTP upgrade. `ContextualAuthenticator` propagates that principal to the existing application-core `Authenticator` port through `AsyncLocalStorage`. The application core still verifies that the authenticated principal matches the command envelope actor.

`BearerTokenConnectionAuthenticator` parses the HTTP bearer token but delegates verification to an injected provider-neutral verifier. C.8.3 does not select an identity provider or account model.

## Delivery contract

Successful canonical events subscribe the originating connection to the match. Events addressed to `all` are delivered to subscribed match sockets; player-addressed events are delivered to every live socket for that authenticated player. Commands from one socket are processed serially.

The adapter additionally enforces configurable origin allowlists, payload and backpressure limits, heartbeat cleanup, and graceful shutdown.
