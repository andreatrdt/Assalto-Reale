# Online lifecycle-command recovery & session expiry

This document records how the web client recovers a **lost create/join response**
and how it handles an **expired anonymous guest identity**. It describes behaviour
as implemented (`web/src/online/onlineIntent.ts`, `onlineClient.ts`, `onlineStore.ts`,
`pages/OnlinePage.tsx`) and the tests that pin it
(`onlineIntent.test.ts`, `onlineClient.test.ts`, `onlineStore.test.ts`,
`packages/authoritative-server/tests/idempotency.test.ts`,
`packages/server-runtime/tests/composedStack.test.ts`).

No protocol, persistence, or migration change was required: recovery reuses the
server's existing **command-receipt idempotency**.

## Problem

`CreateMatch` and `JoinMatch` are the only commands whose authoritative result
*establishes* the client's `matchId`. If that first response is lost (dropped
socket, refresh) before it is applied, the client historically had:

- no `matchId`, so `resumeMatch` could not run, and
- no record of the in-flight command, so any retry generated a **new** commandId
  — which the server would treat as a **second** create/join.

## Persisted intent

Before any network I/O, the client persists a small intent to `sessionStorage`
(`assalto:online-intent`):

```ts
interface PendingLifecycleIntent {
  kind: "create" | "join";
  commandId: string;      // reused verbatim on replay
  command: ClientCommand; // the exact CreateMatch / JoinMatch payload
  createdAt: number;
}
```

Properties:

- **One intent at a time**, mutually exclusive with an established `matchId`
  (the one-match-at-a-time online model).
- **No canonical match state** and **no guest token** are stored inside it.
- **Validated on load**: corrupt JSON, a kind/payload mismatch, or a non-wire-valid
  commandId is discarded and the entry cleared (`loadPendingIntent`).

## Recovery mechanism

The intent's `commandId` is reused on every (re)send. On socket open, when no
`matchId` is yet known, `OnlineClient` replays the persisted command with that
fixed id. The server then either processes it for the first time or, via the
`(playerId, commandId)` receipt, **replays the original authoritative result**
(`MatchCreated` / `PlayerJoined` with the original matchId, invite code, assigned
side, canonical snapshot, lifecycle status, match version and stream sequence).
Changed payload under the same commandId, or a different `playerId`, is rejected
as `duplicate_command`. Exactly one match / one membership results.

## Intent state machine

| Transition | Action |
| --- | --- |
| **Before send** | Persist intent (id + exact payload); set `pendingLifecycle`. |
| **After send** | Intent stays persisted (response not yet safely applied). |
| **On disconnect** | Intent preserved; `OnlineClient` replays it on the next open. |
| **On reconnect** | Replay the same commandId; auto-recovered on mount by `recoverPendingLifecycle`. |
| **On authoritative success** (`MatchCreated`, or our own `PlayerJoined`) | Clear the intent — only now is it safe. |
| **On authoritative rejection** answering this commandId | Clear the intent (it can never succeed as-is) to avoid a replay loop. |
| **On user cancellation** (`startNewMatch` / forget) | Clear the intent and the match. |
| **On session expiry** | Clear the intent — it must never be replayed under a new identity. |

## Session expiry

The WebSocket upgrade rejects an invalid/expired token with an HTTP 401 during the
handshake; the browser surfaces this only as close code **1006**, which is
indistinguishable from a transient drop. The client therefore uses the token's
`expiresAt` as the **deterministic** auth-failure signal:

- If a cached token is already expired at (re)connect time **and** it guards
  identity-bound work (an active `matchId` or a pending intent), `OnlineClient`
  stops the reconnect loop and emits an `expired` status. It does **not** silently
  acquire a new guest identity.
- If an expired token guards **no** match or intent, the stale token is dropped and
  a fresh guest session is acquired normally (nothing depends on the old identity).
- The store maps `expired` to a session-expired UI ("Your session has expired",
  "This match can no longer be resumed from this browser session") offering
  **Start a new match** / **Return home**, and clears the pending intent.
- A transient `offline` status never clears the intent and keeps reconnecting.

## Product limitation

Anonymous guest identities are intentionally **not accounts**: they provide
reconnect identity within one browser session only. An anonymous membership
therefore **cannot survive identity expiry** — once the guest token expires, the
old match can no longer be resumed from that browser. Making memberships durable
across identity expiry would require durable accounts, which are explicitly out of
scope for this branch.
