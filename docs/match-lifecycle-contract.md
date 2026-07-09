# Match lifecycle & persistence contract

> Canonical status is [`current-product-status.md`](current-product-status.md).
> This document records the **actual** current lifecycle, persistence, undo and
> timer behaviour of the web client, established by characterisation tests
> (`web/src/game/state/persistence.test.ts`, `gameStore.test.ts`). It describes
> behaviour as implemented; it does not introduce new rules.

## Where state lives

- Authoritative match state is the Zustand store `web/src/game/state/gameStore.ts`.
- The board is serialized to a snake_case `PythonBoardSnapshot`
  (`web/src/game/engine/serialization.ts`).
- Persistence is a **single** `localStorage` slot: `"assalto-reale-save"`. There
  is no multi-save index and no per-save IDs.

## Save schema

`SavedGame` fields (schema 2, current):

- `schema` (`1 | 2`), `appVersion`, `savedAt`
- `board` (`PythonBoardSnapshot`: config, grid, special/transform squares,
  captured pieces, territory claim; `controlled_squares` is written but
  **recomputed** on load)
- `phase`, `currentPlayer`, `movesThisTurn`, `kingMoved`, `turnCounter`
- `placementCursor`, `currentPlacement`, `piecesLeft`
- `lastAction`, `message`
- `aiEnabled`, `aiPlayer`, `hasActiveMatch`, `matchConfig`, `timeLeft`
- `pendingTransform`, `pendingDefendedKing` (schema 2 only)
- `history` (undo snapshots; schema 2 only)

**Schema 1 (legacy):** same core fields, but `pendingTransform`,
`pendingDefendedKing` and `history` are absent; on load they restore as
`null`/`[]`. This is the only supported migration and it is handled inline by
`restoreSavedGame`.

**Future schemas** (`schema` other than 1 or 2) are rejected — the current code
never interprets an unknown schema as the current one.

## Field disposition on load

| Field | Disposition |
| --- | --- |
| board grid, special/transform squares, captured, territory claim | persisted, restored directly |
| `controlled_squares` | persisted but **recomputed** (`updateControl`) |
| currentPlayer, movesThisTurn, kingMoved, turnCounter, placementCursor, currentPlacement, piecesLeft | persisted, restored |
| pendingTransform, pendingDefendedKing, history | persisted (schema 2), restored |
| timeLeft, matchConfig, aiEnabled, aiPlayer, hasActiveMatch | persisted, restored |
| `selected`, `legalTargets` | **not persisted**; reset to null/[] and recomputed on interaction |
| `clockRunningFor`, `clockLastSyncMs` | **not persisted**; reset to null on load (clock restarts) |

## Meaningful match phases (verified from implementation)

`setup` → `placement` → `playing` → (`defenderSelection` | `transformSelection`)
→ `playing` → `gameOver`. `home` is the pre-match idle state.

- **placement**: snake schedule; `currentPlacement` names the player+piece;
  restrictions enforced by `canPlacePiece`. Match enters `playing` exactly once
  when the last piece is placed.
- **playing**: two action points per turn; the King may act at most once (guarded
  by `kingMoved`). `movesThisTurn` ∈ {0,1,2}.
- **defenderSelection** (pending Defended King): `pendingDefendedKing`
  (owner/action/preview/defenders). The `owner` resolves it via `chooseDefender`
  (human) or `runAiTurn` (AI). Bounce path and landing come from the engine
  preview; the renderer never invents them.
- **transformSelection** (pending Transform): `pendingTransform`
  (owner/pos/player/pieceType/forceTurnSwitch). Owner resolves via
  `chooseTransform`. The stored result is authoritative — a load never rerolls it.
- **gameOver** (terminal): king-capture, territory, or timeout. `message` names
  the winner and reason. No gameplay action is accepted; restart/rematch and
  save remain available.

## Legal / forbidden transitions

- Legal: placement→playing (on completion); playing→defender/transform (on a
  qualifying action); defender/transform→playing (on resolution) or →gameOver (if
  the resolution triggers victory); playing→gameOver (king capture, territory
  maturation, timeout).
- Forbidden: any gameplay mutation once `gameOver`; acting twice from one action
  point; the King acting twice in a turn; resolving a pending decision by a
  non-owner.

## After restoration

Restoration replaces the whole authoritative snapshot atomically (`set(...)`),
recomputes control, clears transient selection, and restarts clocks fresh. The
match then continues normally: a restored pending decision is resolvable, a
restored mid-turn continues with its remaining action point, a restored AI turn
runs once, and a restored `gameOver` accepts no gameplay action.

## After undo

`undo()` restores the previous `HistoryEntry` (board, currentPlayer,
movesThisTurn, kingMoved, turnCounter, placement, phase, message, pending
decisions, timeLeft) — i.e. all authoritative state, not only the board. Undo is
per recorded action/decision snapshot. It never produces an impossible
intermediate (e.g. duplicated action points).

## Timer policy

- The active player's clock decrements from injected `now` deltas; the inactive
  clock is stable; untimed matches (`timerSeconds === 0`) never decrement and
  never produce a timeout.
- **Save**: `saveGame`/`exportSaveJson` first sync the clock, so `timeLeft`
  reflects elapsed time up to the save.
- **Load / page suspension**: `clockRunningFor`/`clockLastSyncMs` are not
  persisted; on load the clock is not running and **no wall-clock time that
  elapsed while unloaded is deducted**. The clock resumes only when the game page
  re-arms it for the active human turn. AI-owned and untimed turns never run the
  clock.
- Timeout sets `gameOver` with a timeout message; it is checked in `clockPatch`
  and does not run once already `gameOver`.

## Pending-decision ownership & resume

Each pending decision carries an explicit `owner`. A human owner resolves it
through the decision UI; an AI owner resolves it via the paced `runAiTurn` loop
in `GamePage`. Restoration preserves the owner, so a reloaded pending decision is
resolved by the same side.

## Validation & failure

Import/restore is validate-before-commit: `validateSavedGame` rejects malformed
data (bad/absent/unknown schema, non-object board/phase, invalid player, out-of
range action points, negative clocks, malformed pending owner, etc.); only a
validated save is restored, and only a successfully restored import is written to
storage. A failed import/save preserves the current active match and returns a
message rather than throwing. `localStorage` unavailability and write failures
(e.g. quota) are handled without corrupting the in-memory game.
