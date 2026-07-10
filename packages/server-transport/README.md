# @assalto-reale/server-transport

Thin HTTP/WebSocket edge for the Assalto Reale authoritative server.

The package owns connection authentication, HTTP/WebSocket lifecycle, message
ordering and event delivery. It delegates every command to the C.8.1
`CommandHandler`; PostgreSQL persistence remains in the C.8.2 adapter. The
transport never reimplements game rules, membership, command idempotency or
version checks.

## Endpoints

- `GET`/`HEAD /healthz` — process liveness;
- `GET`/`HEAD /readyz` — injected dependency readiness;
- optional `POST /session` — short-lived anonymous guest credential;
- optional `OPTIONS /session` — CORS preflight;
- WebSocket `/ws` by default — versioned multiplayer command/event channel.

`/session` exists only when a `GuestSessionIssuer` is supplied. Responses are
non-cacheable and use the same configured origin allowlist as WebSocket upgrades.

## Authentication boundary

`ConnectionAuthenticator` authenticates the HTTP upgrade.
`ContextualAuthenticator` propagates that principal to the application-core
`Authenticator` port through `AsyncLocalStorage`. The application core still
verifies that the authenticated principal matches the command envelope actor.

`BearerTokenConnectionAuthenticator` delegates verification to an injected
provider-neutral verifier.

For C.9 invite play, `HmacGuestSessionService` signs short-lived anonymous
credentials and `GuestSessionConnectionAuthenticator` accepts them through an
HTTP Bearer header or the browser-compatible `access_token` WebSocket query
parameter. Guest sessions are not durable accounts.

```ts
import {
  GuestSessionConnectionAuthenticator,
  HmacGuestSessionService,
  createAuthoritativeTransportServer,
} from "@assalto-reale/server-transport";

const guestSessions = new HmacGuestSessionService(
  process.env.GUEST_SESSION_SECRET!,
);

const transport = createAuthoritativeTransportServer({
  executor,
  readiness,
  guestSessions,
  authenticateConnection: new GuestSessionConnectionAuthenticator(
    guestSessions,
  ),
  allowedOrigins: ["https://play.example"],
});
```

Use a secret containing at least 32 bytes. Production deployment must provide the
secret outside source control and terminate TLS before the public endpoint.

## Delivery contract

Successful canonical events subscribe the originating connection to the match.
Events addressed to `all` are delivered to subscribed match sockets;
player-addressed events are delivered to every live socket for that authenticated
player. Commands from one socket are processed serially.

The adapter additionally enforces configurable origin allowlists, payload and
backpressure limits, heartbeat cleanup, binary-message rejection and graceful
shutdown.

## Client configuration

The web client expects `VITE_MULTIPLAYER_WS_URL`. It derives `/session` from that
URL unless `VITE_MULTIPLAYER_SESSION_URL` is also provided. Without a configured
WebSocket URL, the online page remains visible but host/join actions fail closed.
