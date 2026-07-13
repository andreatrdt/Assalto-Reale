# Durable account authentication foundation

## Scope and architecture

This feature implements the approved Auth0 Universal Login design without
changing gameplay authorization or the multiplayer wire protocol. Email
one-time-password is the primary connection; Google may be enabled later in the
same tenant. The browser uses Authorization Code + PKCE through the official
Auth0 React SDK. Provider access and refresh tokens remain in the SDK's memory
cache and are never written by the application to `localStorage` or
`sessionStorage`.

The durable model deliberately separates:

- `account_users`: application account and status (tombstone, do not hard-delete);
- `account_auth_identities`: unique OIDC `(issuer, provider_subject)` mapping;
- `account_auth_sessions`: hash of the provider session identifier, expiry and
  revocation; provider tokens are not persisted;
- `player_identities`: the actor used by matches, either unowned guest or linked
  to a user;
- `match_memberships`: normalized match/side/player projection, dual-written
  beside the unchanged aggregate columns;
- `registered_websocket_tickets`: SHA-256 hashes of short-lived, single-use
  upgrade tickets.

Existing guest matches are backfilled into player identities and memberships.
The command handler continues to authorize only its authenticated `playerId`
against aggregate membership. A user ID is never a protocol actor and cannot
bypass membership.

## HTTP and WebSocket flow

1. Auth0 Universal Login validates state, nonce, PKCE and the selected identity
   connection. The SPA obtains an audience-bound access token in memory.
2. `POST /auth/session` verifies RS256 signature/JWKS, exact issuer, audience,
   expiry, subject and the configured stable session claim. The server creates
   or loads User/AuthIdentity/AuthSession/PlayerIdentity transactionally.
3. If this browser has an unexpired guest proof, `POST /auth/upgrade-guest`
   verifies that HMAC proof and atomically attaches only that guest player.
   Repeats by the same user are idempotent; another user receives `409`. The old
   guest credential becomes unusable immediately.
4. Before each socket/reconnect, `POST /auth/websocket-ticket` issues a 15–300
   second opaque ticket, scoped to the account's canonical player or the player
   that owns the requested match. Only its hash is stored. The WebSocket sends
   `?ticket=…`; consumption is atomic and replay fails.
5. `GET /auth/matches` returns active normalized memberships for cross-device
   resume. `POST /auth/logout` revokes the application session, then the SPA
   completes provider logout. Revoked provider-session claims cannot silently
   recreate an application session.

All auth responses are `Cache-Control: no-store`, use the existing exact origin
allowlist, cap JSON bodies, return user-safe errors, and never log tokens. Guest
`POST /session` and `?access_token=` WebSockets remain supported.

## Auth0 owner setup (manual)

No tenant was modified by this change. The owner must:

1. Create an Auth0 **Single Page Application** and an API using the exact
   audience configured as `AUTH_AUDIENCE` / `VITE_AUTH0_AUDIENCE`.
2. Enable Universal Login and an email passwordless OTP connection. Optionally
   enable Google after its credentials and consent screen are approved.
3. Set Allowed Callback URLs and Allowed Logout URLs to the exact GitHub Pages
   application URL (including its repository base path) and local development
   URL. Set Allowed Web Origins to those origins only. Do not use wildcards.
4. Add a Post Login Action and deploy it in the Login flow. Set a namespaced
   access-token claim whose value is the stable Auth0 login-session identifier:

   ```js
   exports.onExecutePostLogin = async (event, api) => {
     if (!event.session || !event.session.id) {
       api.access.deny("A stable provider session is required.");
       return;
     }
     api.accessToken.setCustomClaim(
       "https://assalto-reale.example/session_id",
       event.session.id,
     );
   };
   ```

5. Set Railway server variables: `AUTH_ENABLED=true`, tenant issuer (with
   trailing slash), API audience, exact namespaced claim, and optionally ticket
   TTL. Keep the existing `DATABASE_URL`, `GUEST_SESSION_SECRET`, and exact
   `MULTIPLAYER_ALLOWED_ORIGINS`.
6. Set the four `VITE_*` variables in the GitHub Pages build environment. Domain,
   SPA client ID and audience are public configuration; never add a client secret
   to the browser or repository.
7. Validate with a staging tenant first. Do not claim live authentication until
   email delivery, callback URLs, logout, refresh and cross-browser resume have
   been exercised against that tenant.

## Account lifecycle and rollback

There is intentionally no deletion endpoint in this foundation. A future owner
operation must set `account_users.status='deleted'`, revoke sessions/player
identities and retain match memberships for integrity. Hard deletion is not the
supported lifecycle.

Migration 3 is additive and safe to leave in place during rollback. To disable
accounts, set `AUTH_ENABLED=false` and omit the four web auth variables; guest
mode continues on the previous paths. Do not roll back by dropping the account
tables while a newer server may still be running.

## Local and CI testing

Leave auth disabled for normal guest development. Deterministic unit/transport
tests inject a verifier and never contact Auth0. PostgreSQL integration uses:

```bash
TEST_DATABASE_URL=postgresql://assalto:assalto@127.0.0.1:5432/assalto_reale \
  npm --prefix packages/authoritative-server test
```

For a manual local Auth0 test, copy both `.env.example` files, use a development
tenant/callback, start PostgreSQL and the runtime, then start Vite. Never commit
`.env`, `.env.local`, provider credentials or real tokens.
