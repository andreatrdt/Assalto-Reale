# Immutable online match history

## Authority and lifecycle

History is finalized only by the authoritative server. The commit boundary is the existing PostgreSQL unit of work that persists the terminal aggregate and command receipt. In that same transaction it appends the accepted replay event, inserts the immutable summary, and applies registered-player statistic deltas. A failure rolls back all of those writes.

The lifecycle is:

1. A new match starts with `historyCaptureStartedAtVersion = 1` and event sequence zero.
2. Each accepted semantic game command increments the sequence and appends one compact event. Rejected commands and UI-only activity append nothing.
3. The first transition from active to ended finalizes one `match_history` row. The unique match ID and command receipt make retry side effects idempotent.
4. Post-game presence, departure, and rematch negotiation cannot alter the result. A committed rematch adds an append-only predecessor/successor edge and remains a separate authoritative match.

Command receipts remain operational idempotency data. They are not replay data and can be retained under a separate operational policy.

## Compact storage model

Migration 5 creates:

- `match_history_events`: one ordered, versioned accepted command plus small per-side fact deltas; no board snapshots and no cumulative event arrays;
- `match_history`: one immutable completion summary, terminal snapshot, version metadata, compact per-match facts, and SHA-256 integrity checksum;
- `match_history_successors`: an append-only lineage edge, separated because a successor may be committed after its predecessor was finalized;
- `player_statistics`: one derived aggregate per registered account.

Database triggers reject updates or deletes of summaries, events, and lineage edges. They also reject event insertion after summary finalization. Foreign keys use restricted deletion, so cleanup code cannot cascade through completed history.

The terminal snapshot is retained for result integrity and diagnostics. Replay does not use a snapshot per move and does not duplicate the authoritative aggregate.

## Replay contract

Replay schema 1 stores accepted semantic commands. `game-core` recreates the seeded initial state and applies each command in sequence. This reconstructs placement, actions and captures, defended-King decisions and bounce outcomes, transformations, territory changes, pass transitions, and core victory events. Resignation is a versioned terminal semantic command.

Every record stores rules, wire protocol, and replay schema versions. The decoder rejects unsupported versions, sequence gaps, invalid actors, illegal commands, and commands after resignation. It never silently applies current rules to an incompatible record.

Legacy completed matches are backfilled as immutable summaries with `replayAvailable = false`. Their result remains visible, while the UI clearly reports that complete replay capture predates the match.

## Identity and privacy

History endpoints authenticate the provider access token, resolve its server-side session, then authorize through current `player_identities` ownership. They never accept a client-supplied player ID for access control. A nonparticipant receives the same not-found response as a missing private match.

Responses expose a generic opponent display identity and guest/registered kind, not internal player, user, provider subject, session, or authentication identity IDs.

Guest matches are finalized normally. If a guest identity is later claimed, the immutable record is not copied or modified. Current ownership makes it visible to the account, and its derived statistics are rebuilt transactionally and idempotently from all history now owned by that user. Existing account safeguards prevent one account from claiming both sides of a match.

## HTTP API

Authenticated endpoints are:

- `GET /auth/matches/history`: newest-first summaries; cursor pagination (default 20, maximum 50); optional `result`, `side`, `victoryReason`, `completedFrom`, and `completedTo` filters;
- `GET /auth/matches/history/:matchId`: participant-only metadata, per-match facts, terminal summary, ordered replay events, compatibility versions, checksum, and lineage;
- `GET /auth/statistics`: the pre-aggregated account statistic row.

The stable cursor encodes the `(completed_at, match_id)` ordering boundary. The list endpoint never returns event payloads.

## Statistics consistency

For accounts already attached at completion, each first-time history insert updates both statistic rows in the completion transaction. Duplicate terminal command receipts replay the prior response without reapplying deltas. A guest claim replaces the claimant's derived row from immutable summaries ordered by completion time, which also reconstructs current and longest win streaks.

Statistics are derived data; `match_history` remains the source of truth. If a derived row needs repair, rerun the same ordered rebuild logic rather than changing completed history.

## Operations and storage

`PostgresOperationalMaintenanceRepository.historyStorageMetrics()` reports completed summaries, replay event rows, operational receipts, and PostgreSQL relation bytes for the two history tables. Alerting should watch database free space, history bytes per completed match, and unexpected event growth.

`cleanupTransientRecords({ before, limit })` is a bounded hook for old command receipts and consumed/expired WebSocket tickets. It never targets history tables. Choose retention only after the deployment's retry window and incident-investigation needs are defined; do not schedule deletion merely to compensate for unexplained growth.

Recommended checks:

```sql
SELECT COUNT(*) FROM match_history;
SELECT COUNT(*) FROM match_history_events;
SELECT pg_size_pretty(
  pg_total_relation_size('match_history') +
  pg_total_relation_size('match_history_events')
);
```

Back up PostgreSQL before migration 5. The migration is additive and automatically preserves existing ended matches as non-replayable summaries. No completed history cleanup or destructive rollback is provided. Restoring an older application against a migrated database leaves the additive tables unused, but rolling the database schema back requires restoring the pre-migration backup.

## Failure and restart behavior

There is no outbox because the terminal aggregate, receipt, event, summary, and statistics share one PostgreSQL transaction. On process or database failure, either the whole completion is committed or none of it is. The client retry then follows normal command-receipt and optimistic-version behavior. A new server process reads the same immutable rows and can serve replay without in-memory reconstruction state.
