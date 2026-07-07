# Assalto Reale

Assalto Reale is a two-player tactical abstract strategy game for Black and White. This repository is the authoritative source for the native Python/Pygame game and the Pygbag browser build.

The canonical product is:

- 12x12 board
- Black vs White only
- Human vs Human and Human vs Computer
- Manual placement by default
- Optional Quick Balanced setup
- Optional Transform variant, disabled by default

Four-player mode, 2v2, Red/Blue factions, and 18x18 standard play are not active product modes.

## Current Entry Point

The active browser/native entry point is:

```bash
python assalto_pygbag_ready/main.py
```

`main.py` loads `assalto_pygbag_ready/assalto_app_ai.py`, which uses the Pygame UI shell and the headless canonical engine in `assalto_pygbag_ready/assalto_core.py`.

## Architecture

The rules engine lives in `assalto_pygbag_ready/assalto_core.py` and does not import Pygame. It owns:

- board state
- pieces
- legal action generation
- deterministic state transitions
- defended-King previews and bounce resolution
- capture costs
- placement restrictions
- Special Square control
- territory claims
- snapshots, undo support, and JSON serialization

The Pygame layer consumes engine results for live moves, AI simulation, highlights, undo snapshots, and save/load-facing state.

## Pieces

Each player starts with 13 pieces:

| Piece | Count |
| --- | ---: |
| King | 1 |
| Attack Pawn | 4 |
| Defense Pawn | 4 |
| Conquest Pawn | 4 |

## Movement

All pieces may move one adjacent empty square in any of the eight directions.

The King may act at most once per turn. Non-King pieces may act twice in the same turn if action points remain.

## Captures

| Attacker | May capture |
| --- | --- |
| Attack Pawn | Defense Pawn, King |
| Defense Pawn | Conquest Pawn |
| Conquest Pawn | Attack Pawn |
| King | Attack Pawn, Defense Pawn, Conquest Pawn |

Attack Pawns capture orthogonally at range one or two. Defense Pawns capture diagonally at range one or two. Two-square captures cost both action points, require a clear intermediate square, and must be the first action of the turn.

Conquest Pawns and Kings capture adjacent targets only. A King cannot capture another King.

## Turns

Each turn starts with two action points.

| Action | Cost |
| --- | ---: |
| One-square movement | 1 |
| One-square capture | 1 |
| Two-square capture | 2 |
| Pass | Ends turn |

## Defended King

A King is defended when at least one friendly Defense Pawn occupies any adjacent square. If an Attack Pawn attacks a defended King:

- one eligible Defense Pawn is sacrificed
- the King remains alive
- the Attack Pawn survives
- the Attack Pawn bounces directly backward along the attack line
- the bounce travels up to five squares from the King
- the bounce stops before the board edge or an occupied square
- the attacker's origin is treated as empty during bounce calculation
- the turn ends immediately

The engine returns a `DefendedKingPreview` before resolution. The preview includes attack path, bounce path, landing square, eligible defenders, action cost, and whether the landing square triggers Transform.

## Placement

Manual placement is the default. Players place pieces in this order:

1. King
2. Four Attack Pawns
3. Four Defense Pawns
4. Four Conquest Pawns

The placement schedule is explicit snake order:

```text
Black 1, White 2, Black 2, White 2, ... Black 2, White 1
```

Restrictions:

- no occupied squares
- no Special Squares
- no Transform Squares
- Black King in the left half
- White King in the right half
- Black Attack Pawns in the first two columns
- White Attack Pawns in the final two columns
- Conquest Pawns at Chebyshev distance at least three from every Special Square

Quick Balanced setup uses the same legality checks and deterministic scoring.

## Territory Victory

Special control is derived from Conquest Pawn positions on Special Squares. A player must hold a strict majority of Special Squares. A claim is created at the end of a turn, the opponent receives a complete response turn, and the claim matures on the claimant's next turn only if continuous majority control is retained.

King capture takes precedence over territory and timeout outcomes.

## Transform Variant

Transform is optional and disabled by default. When enabled, the engine can generate a Transform Square after the configured movement-round threshold. A pawn landing on it may transform into a different pawn type; Kings cannot transform.

## AI

Human vs Computer supports human side selection:

- Black
- White
- Random

AI difficulty levels:

- Easy: shallow, fast search
- Medium: balanced turn search
- Hard: deeper turn search with higher candidate limits and a browser time budget

AI legal moves and simulations are routed through the same engine transitions used by human moves.

## Save Format

The engine supports exact JSON serialization through `Board.to_json()` and `Board.from_json()`. The active UI Save/Load buttons write `moves.txt` as a versioned `assalto_reale_snapshot` JSON document containing the canonical board state, clocks, placement state, mid-turn action state, territory claim, transform state, mode settings, and snapshot-backed undo history. Legacy text `moves.txt` logs are still accepted as a fallback loader.

## Run Native

Install dependencies:

```bash
python -m pip install -r PY_Assalto_reale/requirements.txt
```

Run:

```bash
python assalto_pygbag_ready/main.py
```

## Run Tests

```bash
python -m pytest -q
```

The core tests are headless and do not open a Pygame window.

## Headless Benchmarks

Run seeded engine simulations without Pygame:

```bash
python assalto_pygbag_ready/assalto_benchmarks.py --games 4 --seed 1234 --max-turns 160
```

The benchmark reports win counts, victory reasons, average and median game length, captures, Defense Pawn sacrifices, bounces, average bounce distance, transform availability/use, Special Square control-turn totals, and illegal-action count. Add `--transform` to enable the optional Transform variant during simulations.

## Pygbag Build

Install browser build dependencies:

```bash
python -m pip install -r PY_Assalto_reale/requirements_web.txt
```

Build:

```bash
python -m pygbag assalto_pygbag_ready
```

Generated browser output belongs in the deployment repository `andreatrdt/AssaltoRealeWeb`. Do not manually patch gameplay logic in compiled Pygbag output.

## Deployment Workflow

1. Finish and test source changes in `andreatrdt/Assalto-Reale`.
2. Run `python -m pytest -q`.
3. Smoke-test the native app.
4. Build with Pygbag.
5. Test the local browser build where possible.
6. Copy generated deployable output to `andreatrdt/AssaltoRealeWeb`.
7. Record the source commit and exact build command.

## Known Limitations

- The current Pygame UI has been partially restructured around the canonical engine, but a full visual redesign and modal system remains ongoing.
- Save/Load now uses canonical JSON snapshots, but cloud/browser storage behavior still depends on the runtime environment.
- Defended-King preview and defender choice are implemented in the active UI; broader animation polish remains ongoing.
- Browser build/deployment has not been regenerated in this branch yet.
