# Post-game lifecycle and presence

Completed results and resumable participation are separate concepts. An ended
match keeps its authoritative board, result, reason, members, predecessor and
successor links. Clearing a browser CTA or leaving a post-game room never deletes
that match.

## Client lifecycle

The web client persists one of three values with its online match pointer:

| Lifecycle                             | Home action                                              |
| ------------------------------------- | -------------------------------------------------------- |
| `active`                              | `Resume Match`                                           |
| `postGame`, self `present` or `grace` | `Return to post-game room`                               |
| no pointer, or self `absent`          | no active-match action (`Play Online` remains available) |

Local games clear `hasActiveMatch` when `game-core` reaches `gameOver`, including
when an older completed save incorrectly stored the flag as true. The completed
board and result are retained.

## Authoritative state machine

Each ended match stores `postGame.Black` and `postGame.White` as:

```text
present --socket close--> grace(deadline)
grace --RequestSync before deadline--> present
grace --deadline reached--> absent
present|grace --LeavePostGame--> absent
absent --explicit RequestSync/re-entry--> present
```

`LeavePostGame` is immediate and idempotent. Socket closure alone is never a
deliberate departure. A reconnect grace defaults to 30 seconds and is configured
with `POST_GAME_RECONNECT_GRACE_SECONDS`.

Any transition to `absent` clears the pending rematch offer in the same aggregate
write. Re-entry never restores a cleared offer. Rematch offer/accept commands are
accepted only while both members are `present` or `grace`; otherwise the server
returns `post_game_unavailable` with the current snapshot. RequestSync first
expires elapsed grace deadlines and returns the canonical post-game snapshot.

## Race and commit rules

- Post-game commands retry optimistic-write conflicts against current state.
- Duplicate departures do not increment the match version twice.
- Exact rematch-command receipt retries return current canonical state instead of
  replaying a stale transient offer or decline.
- If departure commits first, a later offer or accept is rejected.
- If successor creation commits first, the transaction has atomically written the
  new match and the old match's `successorMatchId`. A later departure is redirected
  to that successor and never rolls it back.
- Simultaneous departures converge to both members absent.
- An explicit departure followed by socket close is a no-op on presence.

The atomic persistence transaction that writes both aggregates is the successor
commit boundary. Completed gameplay state is never mutated by these transitions;
only post-game metadata, the offer, version/stream sequence and successor link may
change.

## Protocol and compatibility

Protocol v1 introduced the `LeavePostGame` command, `PostGamePresenceChanged`
event, `postGame` snapshots, and `post_game_unavailable` rejection. Protocol v2
retains those semantics unchanged. Snapshot fields remain optional so stored v1
receipts remain readable.

Migration 4 adds `authoritative_matches.post_game_presence JSONB`. Existing ended
matches are backfilled with both members absent, so an upgrade cannot expose an
old result as an active room or revive an old offer. Existing active matches keep
the column null. Explicit re-entry can create fresh post-game participation, but
cannot restore an earlier offer.

Deadlines and presence are durable across restart. The next sync or post-game
command expires any elapsed deadline even if the in-process timer was lost.
The current runtime is a single authoritative transport process; it has no
distributed WebSocket registry. PostgreSQL optimistic concurrency keeps durable
transitions safe, but live multi-instance presence routing requires a future
shared connection registry/event bus before the runtime can claim multi-instance
WebSocket support.
