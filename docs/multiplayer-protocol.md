# Assalto Reale multiplayer protocol v1

## Status

This document defines Phase B.7 of the roadmap: the transport-independent contract between future Assalto Reale clients and an authoritative server.

The protocol is implemented by `packages/multiplayer-protocol`. It defines JSON message types, runtime validation and codecs only. It does **not** implement a server, database, authentication provider, WebSocket connection or matchmaking.

## Design principles

1. **Server authority** — clients propose commands; only the server applies `game-core`, advances versions and publishes canonical state.
2. **Transport independence** — the same JSON envelopes can travel over Socket.IO, WebSocket or HTTP.
3. **Idempotency** — every command has a client-generated `commandId`.
4. **Optimistic concurrency** — state-changing commands include `expectedMatchVersion`.
5. **Explicit causality** — server events record the command that caused them.
6. **Ordered streams** — `matchVersion` identifies aggregate state while `streamSequence` orders multiple events produced by the same version.
7. **Runtime validation** — untrusted JSON is validated before application.
8. **Versioned evolution** — incompatible changes require a new `protocolVersion`.
9. **No credentials in messages** — authentication tokens remain in the transport/session layer.
10. **Canonical snapshots** — game state payloads use game-core snapshots.

## Envelope constants

```text
protocol        = "assalto-reale"
protocolVersion = 1
```

Unknown protocol names or versions are rejected before command dispatch.

## Client command envelope

```ts
interface ClientCommandEnvelope {
  protocol: "assalto-reale";
  protocolVersion: 1;
  messageType: "command";
  commandId: string;
  sentAt: string;
  actor: {
    playerId: string;
    sessionId: string;
  };
  matchId: string | null;
  expectedMatchVersion: number | null;
  command: ClientCommand;
}
```

`sentAt` is diagnostic only. The server must never use a client timestamp for turn order, clock enforcement or conflict resolution.

The authenticated connection principal must match `actor.playerId`. The server must reject spoofed actor data. Authentication credentials are carried by the connection handshake or HTTP authorization layer, never inside this envelope.

## Commands

### Match lifecycle

```text
CreateMatch
JoinMatch
RequestSync
Resign
OfferRematch
RespondToRematch
```

`CreateMatch` has `matchId = null` and `expectedMatchVersion = null`. The client selects public game options but never supplies the deterministic setup seed; the server generates and persists it.

`JoinMatch` supplies the invitation code, with no expected version. `matchId` is optional: the joining device only knows the code, so it normally sends `matchId = null` and the server resolves the invite. When a `matchId` is supplied the server loads it directly; either way it validates the invitation and assigns the open side.

`RequestSync` supplies `lastSeenMatchVersion` and no expected version. The first server implementation may always answer with a full canonical snapshot. A later implementation can return events since the requested version without changing the command shape.

### Game commands

```text
PlacePiece
SubmitAction
ChooseDefender
CancelDefendedKing
ChooseTransform
PassTurn
```

These six wire commands are compile-time compatible with the corresponding `game-core` commands. The future server validates player ownership and aggregate version before converting them to `game-core.applyCommand()`.

### Version requirements

Every state-changing command after creation/join requires:

```text
matchId              = current match
expectedMatchVersion = client's canonical version
```

The server accepts the command only when the expected version equals the stored version. Accepted commands that mutate the aggregate increment `matchVersion` exactly once. A stale command produces `CommandRejected` with code `stale_match_version`, the current version and, when useful, a canonical snapshot.

## Match creation configuration

```ts
type OnlineMatchConfig = {
  visibility: "invite";
  placementMode: "Manual" | "QuickBalanced";
  transformEnabled: boolean;
  preferredSide: "Black" | "White" | "Random";
  timeControl:
    | { kind: "untimed" }
    | {
        kind: "clock";
        initialSeconds: number;
        disconnectGraceSeconds: number;
      };
};
```

Product clients always send `placementMode: "Manual"` — every match is played through the placement phase. The `"QuickBalanced"` value is retained in the type only for backward compatibility with already-persisted matches and internal tests; no production create flow emits it.

Phase C.9 launches invite-based **untimed** matches first. The clock variant is reserved by v1 for Phase C.11; the initial server may reject it until server-authoritative clock policy is implemented.

## Server event envelope

```ts
interface ServerEventEnvelope {
  protocol: "assalto-reale";
  protocolVersion: 1;
  messageType: "event";
  eventId: string;
  emittedAt: string;
  matchId: string | null;
  matchVersion: number | null;
  streamSequence: number | null;
  causationCommandId: string | null;
  recipient: "all" | { playerId: string };
  event: ServerEvent;
}
```

`eventId` is globally unique. `streamSequence` is monotonically increasing for accepted aggregate events and gives a strict order even when one accepted command emits several events at the same `matchVersion`.

Recipient-specific command rejections do not enter the aggregate event stream and therefore have `streamSequence = null`.

## Events

```text
MatchCreated
PlayerJoined
MatchUpdated
DecisionRequired
TurnChanged
MatchEnded
CommandRejected
RematchOffered
RematchCreated
MatchSnapshot
```

`MatchUpdated` contains the canonical snapshot plus serializable domain events reported by game-core. Specific events such as `DecisionRequired`, `TurnChanged` and `MatchEnded` make common client reactions explicit without requiring UI code to infer them from a state diff.

A server may publish multiple envelopes for one accepted command. They share the same `matchVersion` and `causationCommandId`, while `streamSequence` determines their order.

## Pending decisions

Defended King and Transform remain explicit protocol events.

### Defended King

```ts
{
  type: "DecisionRequired",
  decision: {
    kind: "defendedKing",
    owner: "White",
    defenders: [[4, 3]],
    attackerOrigin: [5, 1],
    kingPosition: [5, 3],
    landingPosition: [5, 5]
  }
}
```

Only the decision owner may send `ChooseDefender` or `CancelDefendedKing` for the current version.

### Transform

```ts
{
  type: "DecisionRequired",
  decision: {
    kind: "transform",
    owner: "Black",
    position: [5, 6],
    currentType: "AttackPawn",
    options: ["DefensePawn", "ConquestPawn"]
  }
}
```

Only the decision owner may submit `ChooseTransform`.

## Rejections

Structured rejection codes include:

```text
invalid_message
unsupported_protocol_version
unauthenticated
unauthorized
match_not_found
invite_invalid
match_full
stale_match_version
duplicate_command
not_your_turn
illegal_command
decision_required
match_ended
rate_limited
internal_error
```

The server should avoid exposing stack traces, database details or sensitive account data in rejection messages.

## Idempotency policy

The authoritative server stores the outcome associated with `(playerId, commandId)` for an appropriate retention period.

- First receipt: validate and execute normally.
- Exact duplicate: replay the previously generated result without applying the command again.
- Reused `commandId` with a different payload: reject as `duplicate_command`.

This prevents double moves after retries, reconnects or network uncertainty.

## Event and state ordering

Clients maintain both:

```text
lastMatchVersion
lastStreamSequence
```

Rules:

1. Ignore an already processed `eventId`.
2. Apply aggregate events in ascending `streamSequence`.
3. If a sequence gap is detected, stop optimistic application and send `RequestSync`.
4. Replace local canonical state only with an equal-or-newer `matchVersion`.
5. UI animations may lag behind, but the canonical state cannot.

## Reconnection

After reconnecting, the client authenticates the session and sends:

```ts
{
  type: "RequestSync",
  lastSeenMatchVersion: 12
}
```

The Phase C server may answer with `MatchSnapshot`. Later, it can replay retained server events and then provide a snapshot if the client is too far behind.

## Server command pipeline

The future authoritative server processes a command in this order:

1. Decode and validate the protocol envelope.
2. Authenticate the connection.
3. Confirm the authenticated principal matches `actor.playerId`.
4. Enforce rate limits and idempotency.
5. Load the match aggregate transactionally.
6. Validate membership, side and pending-decision ownership.
7. Compare `expectedMatchVersion` with the stored version.
8. Convert the wire command to a game-core command.
9. Run `game-core.applyCommand()`.
10. Persist the canonical snapshot and increment the version atomically.
11. Persist outgoing event envelopes and stream sequence.
12. Commit the transaction.
13. Broadcast canonical events to authorized recipients.

The client never determines legality, captures, Transform results, territory, victory or timeouts for the authoritative match.

## Privacy and security boundaries

- Authentication tokens stay outside protocol JSON.
- `playerId` is verified against the authenticated connection.
- Invitation codes are secrets with rate-limited lookup.
- Match snapshots are sent only to authorized participants or explicitly supported spectators.
- Commands are size-limited before JSON parsing.
- Unknown fields may be ignored for compatible additive evolution, but unknown command/event types are rejected.
- Server logs redact invitation codes and authentication material.

## Protocol evolution

Compatible v1 changes may add optional fields or new command/event variants when old clients can safely ignore them. Breaking field semantics, required fields or ordering rules require `protocolVersion = 2`.

The server advertises supported versions during connection setup. A client using an unsupported version receives `unsupported_protocol_version` and must not continue the match session.

## Phase B.7 definition of done

- protocol package builds without browser dependencies;
- client and server envelopes have runtime validators and JSON codecs;
- every mutation has idempotency and version semantics;
- multiple events per match version are strictly ordered;
- game commands are compile-time compatible with game-core;
- Defended King and Transform decisions are explicit;
- reconnection and stale-command behaviour are specified;
- no networking or server implementation is introduced;
- full repository CI remains green.
