# Rules parity contract (Python ⇄ TypeScript)

Defines the canonical, observable behaviour both engines must agree on, how
parity is measured, the shared randomness policy, and which engine is
authoritative. This is the reference for the parity test suite and for any
future `game-core` extraction.

- **Python reference engine:** `assalto_pygbag_ready/assalto_core.py`
  (class-based `Board`/`Piece`/`GameConfig`). The scripts under
  `PY_Assalto_reale/` are the original tkinter/pygame builds and are **not** the
  parity reference.
- **TypeScript engine:** `web/src/game/engine/*`.
- **Fixture pipeline:** `web/scripts/generate_engine_fixtures.py` (imports the
  Python engine) → `web/tests/fixtures/python-engine-fixtures.json` → consumed by
  `web/src/game/engine/pythonParity.test.ts` and `randomParity.test.ts`.

> Where this contract and older design notes disagree, this document and the
> executable fixtures win. `docs/python-web-parity.md` is a historical matrix.

## Parity taxonomy

Every parity assertion is one of three kinds:

- **Exact parity** — both engines must produce the same legal action set, action
  result, resulting board, active player, action points, pending decision,
  territory state, winner and victory reason. Compared as normalized snapshots.
- **Semantic parity** — behaviour is equivalent but representation may differ
  (map/set ordering, internal ids, non-authoritative messages, UI-only
  metadata). Normalized away before comparison (e.g. Python `set` of squares is
  compared as a sorted list).
- **Intentional non-parity** — differences deliberately retained: browser-only
  presentation/animation state, legacy Python UI state, old-save compatibility
  fields, engine-local caches, and **unseeded** generation (a real match that
  pins no seed is non-deterministic per engine — only *seeded* generation is a
  contract).

## Normalized interchange snapshot

The neutral snapshot is `PythonBoardSnapshot` in
`web/src/game/engine/serialization.ts` (`fromPythonSnapshot` / `toPythonSnapshot`),
mirrored by the Python `Board.to_dict()`. It carries only authoritative state:

- `config` (rows, cols, special_count, transform_enabled, transform_round)
- `grid` (row-major; each cell `null` or `{player, type}`)
- `special_squares`, `transform_squares` (as `[row, col]` lists)
- `controlled_squares`, `captured_pieces`, `territory_claim`

Normalization rules: deterministic row-major/coordinate ordering; sets emitted as
sorted lists; no timestamps, animation data, clocks, or non-authoritative
messages. Tests compare normalized snapshots, never raw internal objects.

## Canonical observable rules

Board is row-major, origin top-left; coordinates `[row, col]`. Players are
`"Black"` and `"White"`. Piece types: `King`, `AttackPawn`, `DefensePawn`,
`ConquestPawn`. Default match: 12×12, 5 Special Squares, Transform disabled.

The following are **proven equivalent** by the committed fixtures
(`pythonParity.test.ts`, 66 cases): single-piece movement in all 8 directions at
range 1 (cost 1); out-of-bounds / friendly-occupied / illegal-long-move / no-AP
rejections; the capture hierarchy (Attack→Defense/King, Defense→Conquest,
Conquest→Attack, King→pawns, no King→King) with legal and illegal pairs;
range-2 Attack (orthogonal) and Defense (diagonal) captures incl. blocked and
after-first-action; King acts once per turn; placement restrictions; territory
claim creation/maturation and special control; the Defended-King preview fields.

Complete turns and special mechanics are additionally **proven equivalent** by
the sequence suite (`sequenceParity.test.ts`, 55 scenarios). Each scenario
replays the Python reference engine's step sequence through the TypeScript
engine, threading action points and King-acted state exactly as the engine
reports them (`next_moves_this_turn` / `next_king_moved`), and asserts, per step:
the **legal-action set** (curated scenarios), the built action, the transition
result and a compact normalized board snapshot. Coverage:

- **Complete turns** (10): two actions by the same/different piece; move→move,
  move→capture, capture→turn-end; move→pass and full pass; King action followed
  by a legal non-King action; a rejected second King action; two-action turn end
  and reset; and an inter-turn player change via an explicit turn reset.
- **Defended King** (7): single and multiple defenders (each selectable);
  invalid-defender rejection; bounce blocked by an occupant; bounce landing on a
  Transform Square (`triggers_transform`); and a range-2 defended attack — each
  emitting the `defended_king` → `capture` → `bounce` event chain.
- **Transform** (3): move onto a Transform Square then convert to each pawn type,
  with seeded Transform-Square relocation, and a no-relocation case.
- **Territory** (3): claim creation → progression → maturation into a territory
  victory at the turn boundary; and cancellation by both a move and a capture.
- **Victory** (2): King-capture victory, and **precedence** — a King capture
  wins even while the capturing side holds a mature-able territory majority.
- **Generated** (30): deterministic seeded legal full-turn sequences (two turns
  each) drive both engines through the shared PRNG; the seed is in each scenario
  name for reproducible replay.

No divergences were found: the TypeScript engine reproduced every Python
reference value across all 55 scenarios (and the 66 single-action + 20 seeded
fixtures). Terminal-state immutability and timeout are **store-level**
orchestration, not pure-engine behaviour (see "Intentional non-parity").

## Randomness policy (canonical)

Both engines use one shared, fully specified PRNG so seeded generation is
**byte-identical** across runtimes:

- **Algorithm:** Mulberry32 over an unsigned 32-bit seed.
  `web/src/game/engine/random.ts` and `assalto_pygbag_ready/assalto_prng.py` are
  line-for-line equivalent (verified: identical float streams for seeds
  `0,1,123,999999,2^32-1,…`).
- **`next()`** returns `state_u32 / 2^32` in `[0, 1)`.
- **`randomInt(bound)`** = `floor(next() * bound)`, one draw.
- **Shuffle** is Fisher-Yates from the last index down, one draw per step
  (`j = randomInt(i + 1)`).
- **Choice** = `seq[randomInt(seq.length)]`, one draw.
- **Candidate ordering** is row-major before any shuffle/choice; Transform
  candidates are additionally `sort`ed (by row, then col) before choice.
- **Special Square generation:** build row-major candidates (rows `1..R-2`; cols
  `3..C-4` when `C≥8`, else `1..C-2`), shuffle with the seed, greedily take
  squares with Chebyshev spacing ≥ 3 until `count`; atomic failure otherwise.
- **Transform Square selection:** build the equidistant-to-two-different-player
  candidates, `sort`, then `choice` with the seed.

**Seed lifecycle & save compatibility.** Seeds are per-generation inputs; the
generator does not advance a shared global stream. Generated squares are
**persisted in saves** (`special_squares` / `transform_squares`), so loading a
save never re-rolls — restoring a match reproduces the exact stored squares
regardless of PRNG. Adopting the shared PRNG therefore affects **only newly
created matches**; no existing save changes meaning. Unseeded generation (no seed
pinned) remains engine-local and non-deterministic by design.

Cross-runtime proof: `randomParity.test.ts` (20 cases) asserts the TypeScript
engine reproduces the Python engine's raw PRNG stream and its seeded Special and
Transform Square outputs exactly.

## Authority model

- **Future production authority:** the **TypeScript** engine. It already ships in
  the web client and is the intended basis for the web/multiplayer server; the
  shared Mulberry32 spec is deliberately simple to reimplement in any server
  language.
- **Reference oracle:** the **Python** engine (`assalto_core.py`). It generates
  the parity fixtures and remains the regression oracle.
- **Transition criteria:** a behaviour becomes TS-authoritative once it is covered
  by exact-parity fixtures generated from Python and green in CI. Single actions,
  complete turns, Defended King, Transform, territory, victory precedence and
  seeded generation are now covered, so those areas are TS-authoritative with
  Python as the oracle. New rule changes must still land in **both** engines and
  be fixture-checked until the remaining permutations below are covered.

This document does **not** authorize a `game-core` extraction or a `gameStore.ts`
refactor — those are separate, later work.

## Fixture pipeline commands

Run from `web/`:

- `npm run parity:generate` — regenerate `tests/fixtures/python-engine-fixtures.json`
  from the Python engine (needs `python`; no pygame required).
- `npm run parity:check` — fail if the committed fixtures are stale (regenerates
  into a temp file and byte-compares; never mutates the committed file).
- `npm run parity:test` — run the TypeScript parity suites (single-action,
  seeded-generation and sequence) against the fixtures.

## Intentional non-parity (store-level)

The pure engines do not model these; they live in the web store / Python app and
are **not** compared here:

- **Turn orchestration** — whose turn it is, switching players and resetting
  action points at the boundary. The parity harness drives these explicitly
  (`reset_turn`) and compares the engine's per-action accounting.
- **Terminal-state immutability** — refusing further input after a win is a
  store concern; the engine still computes actions on a finished board.
- **Timeouts** — the countdown/timeout victory exists only in the web store, not
  the pure Python engine.

## Remaining (deferred, tracked)

Proven: the shared PRNG + seeded generation parity; single-action / capture /
placement fixtures; and complete-turn, Defended-King, Transform, territory,
victory-precedence and generated-sequence parity (`sequenceParity.test.ts`).

Still open (not blocking a behaviour-preserving `gameStore.ts` decomposition):
exhaustive enumeration of every Defended-King bounce geometry and Transform
candidate layout; larger generated-sequence budgets (more seeds / longer turns);
and a property-based framework (Hypothesis ⇄ fast-check) — deliberately **not**
adopted here in favour of the shared deterministic generator, which keeps one
fixture pipeline. This is strong behavioural parity for full turns and special
mechanics; it is not a proof of total equivalence for every reachable position.
