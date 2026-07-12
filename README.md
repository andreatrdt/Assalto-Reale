# Assalto Reale

Assalto Reale is a two-player tactical abstract strategy game for Black and White. This repository contains the canonical Python rules reference, the native Pygame client and the modern React/TypeScript web client.

**Authoritative status:** [`docs/current-product-status.md`](docs/current-product-status.md) is the single source of truth for what currently ships, what is retained for compatibility, and current limitations. Release steps are in [`docs/release-checklist.md`](docs/release-checklist.md); version history is in [`CHANGELOG.md`](CHANGELOG.md). Other `docs/` files are design/audit history.

The modern web client is deployed to GitHub Pages at `https://andreatrdt.github.io/Assalto-Reale/`.

## Current public game

The public web experience uses:

- a 12×12 board
- Black vs White
- Human vs Human or Human vs Computer
- manual placement for every new match
- Transform enabled for every new match
- timed or untimed play
- local save/load and save-file import/export

The internal `QuickBalanced` setup path and older configuration values remain in the codebase only for tests, fixtures and deserializing already-persisted matches/saves. They are not used by any production match — every game (local, online, resumed or restarted) always begins with the placement phase.

Four-player mode, 2v2, Red/Blue factions and 18×18 standard play are not active product modes.

## Entry points

### Modern web client

```bash
cd web
npm ci
npm run dev
```

The React application in `web/` is the current product interface under active development.

### Canonical Python implementation

```bash
python assalto_pygbag_ready/main.py
```

`assalto_pygbag_ready/assalto_core.py` is the canonical Python rules reference used for parity fixtures and headless tests.

## Architecture

The Python rules engine owns:

- board state and pieces
- legal action generation
- deterministic state transitions
- defended-King previews and bounce resolution
- action-point and capture costs
- placement restrictions
- Special Square control and territory claims
- Transform state
- snapshots, undo and serialization

The React client mirrors the rules in TypeScript under `web/src/game/engine/`. Zustand state in `web/src/game/state/` coordinates the match lifecycle, timers, AI turns, undo and browser persistence.

## Pieces

Each player starts with 13 pieces:

| Piece | Count |
| --- | ---: |
| King | 1 |
| Attack Pawn | 4 |
| Defense Pawn | 4 |
| Conquest Pawn | 4 |

## Movement

Every piece may move one square to any adjacent empty square, including diagonally.

The King may act at most once per turn. A non-King piece may act twice when action points and legal actions remain.

## Captures

| Attacker | May capture |
| --- | --- |
| Attack Pawn | Defense Pawn, King |
| Defense Pawn | Conquest Pawn |
| Conquest Pawn | Attack Pawn |
| King | Attack Pawn, Defense Pawn, Conquest Pawn |

Attack Pawns capture orthogonally at range one or two. Defense Pawns capture diagonally at range one or two. A two-square capture:

- costs both action points
- requires a clear intermediate square
- must be the first action of the turn

Conquest Pawns and Kings capture adjacent targets only. A King cannot capture another King.

## Turns

Each turn begins with two action points.

| Action | Cost |
| --- | ---: |
| One-square movement | 1 |
| One-square capture | 1 |
| Two-square capture | 2 |
| Pass | Ends turn |

## Defended King

A King is defended while at least one friendly Defense Pawn occupies an adjacent square. If an Attack Pawn attacks a defended King:

- one eligible Defense Pawn is sacrificed
- the King survives
- the attacking pawn survives
- the attacking pawn bounces directly backward along the attack line
- the bounce travels up to five squares from the King
- the bounce stops before the board edge or an occupied square
- the attacker’s origin is treated as empty during bounce calculation
- the turn ends immediately

When several Defense Pawns are eligible, the defending player chooses which one is sacrificed.

The engine produces a `DefendedKingPreview` before resolution. It includes the attacker, King, eligible defenders, attack path, bounce path, landing square, action cost, Transform trigger and turn result.

## Placement

Every newly started public match uses manual placement. Pieces are placed in this order:

1. King
2. four Attack Pawns
3. four Defense Pawns
4. four Conquest Pawns

The snake schedule is:

```text
Black 1, White 2, Black 2, White 2, … Black 2, White 1
```

Placement restrictions:

- no occupied squares
- no Special Squares
- no Transform Squares
- Black King in the left half
- White King in the right half
- Black Attack Pawns in the first two columns
- White Attack Pawns in the final two columns
- Conquest Pawns at Chebyshev distance at least three from every Special Square

`QuickBalanced` remains an internal, test-only compatibility path (fixtures and historical save/match deserialization). No production match uses it; every match is played through manual placement.

## Special Squares and territory victory

Only Conquest Pawns standing on Special Squares control them. Holding a strict majority creates a territory claim at the end of the turn.

The opponent receives one complete response turn. The claim matures on the claimant’s next turn only if the majority has been maintained continuously.

## Transform

Transform is enabled for every newly started public web match. After the configured movement-round threshold, the engine may generate a Transform Square.

A pawn that lands on the Transform Square may change into a different pawn type. Kings cannot transform.

The serialized configuration still retains the Transform flag so older saves with Transform disabled remain loadable.

## Victory

A match can end through:

- King capture
- a matured territory claim
- timeout

King capture takes precedence when more than one victory condition is reached by the same action.

## Computer opponent

Human vs Computer supports selecting the human side:

- Black
- White
- Random

The public setup screen intentionally does not show AI difficulty levels. The current web AI generates legal actions through the shared engine and chooses among them with deterministic scoring. Older difficulty values remain accepted in saved configurations for compatibility.

## Web save and load

The modern web client stores one local save in the browser and supports:

- save during placement or play
- load and continue
- delete local save
- export a saved match to JSON
- export the current in-memory match
- import a compatible JSON save
- schema-1 and schema-2 compatibility
- pending defended-King and Transform decisions
- timer and undo state where present in the save format

## Run the web client

```bash
cd web
npm ci
npm run test
npm run build
npm run e2e
npm run dev
```

Python ⇄ TypeScript parity is fixture-driven (contract:
[`docs/rules-parity-contract.md`](docs/rules-parity-contract.md)). From `web/`:

```bash
npm run parity:generate   # regenerate fixtures from the Python engine (needs python)
npm run parity:check      # fail if the committed fixtures are stale
npm run parity:test       # single-action + seeded-generation + complete-turn/mechanic parity
```

To package a reviewable static artifact:

```bash
cd web
npm run package:release
```

The package is written to `release/assalto-reale-web-v1/` with source commit metadata.

## Run the Python client

Install dependencies:

```bash
python -m pip install -r PY_Assalto_reale/requirements.txt
```

Run:

```bash
python assalto_pygbag_ready/main.py
```

Run the headless Python tests. The rules-engine suite only needs `pytest`
(the engine itself uses the standard library only), pinned in
`requirements-dev.txt`:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

## Headless benchmarks

```bash
python assalto_pygbag_ready/assalto_benchmarks.py --games 4 --seed 1234 --max-turns 160
```

The benchmark reports wins, victory reasons, game length, captures, Defense Pawn sacrifices, bounces, Transform activity, Special Square control and illegal-action counts.

## Legacy Pygbag build

```bash
python -m pip install -r PY_Assalto_reale/requirements_web.txt
python -m pygbag --build --ume_block 0 assalto_pygbag_ready
```

Pygbag is the legacy browser runtime, historically hosted from the separate `andreatrdt/AssaltoRealeWeb` repository. The current public product is the modern React client on GitHub Pages (see above); the Pygbag build is retained only as a legacy/fallback reference.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`
and `release/**`, using **Python 3.12** and **Node 22**. It is split into
independent jobs so a failure in one is diagnosable without hiding the others:

- `python-tests` — installs `requirements-dev.txt` (pytest), then `python -m pytest -q`.
- `web-static-quality` — `npm ci`, `typecheck`, `lint`, `format:check`, `audit:prod`.
- `web-unit-build` — `npm ci`, `test:coverage` (coverage thresholds), `build`.
- `web-e2e` — `npm ci`, `npx playwright install --with-deps chromium`, `e2e`.

Playwright's Chromium is installed only in the e2e job. The production dependency
audit (`npm audit --omit=dev`) must report zero vulnerabilities. The overall
workflow fails if any required job fails. The full local release procedure is in
[`docs/release-checklist.md`](docs/release-checklist.md).

## Deployment

The modern deployment path is documented in `docs/deployment.md`.

1. Finish and test source changes in this repository.
2. Run the Python and web validation suites.
3. Package the web artifact with `npm run package:release`.
4. Publish the reviewed static files to the chosen host.
5. Record the source commit from `release-metadata.json`.

The manual `Package Web Artifact` workflow creates a reviewable artifact. It does not automatically overwrite the legacy deployment repository.

## Known limitations

- The public deployment still serves the legacy Pygbag build rather than the React client.
- The web AI is functional but intentionally basic; difficulty levels are not yet meaningfully distinct.
- Board and interface animation/audio polish is still in progress.
- Exact Python/TypeScript parity continues to be validated through fixtures and tests.
