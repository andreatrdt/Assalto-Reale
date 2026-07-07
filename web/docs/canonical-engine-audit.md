# Canonical Engine Audit

The current reference implementation is `assalto_pygbag_ready/assalto_core.py`. The modern web migration must preserve this behavior until TypeScript parity is proven.

## Public Surface

- `Board`: mutable canonical board with a Python matrix API, cloning, JSON serialization and transition methods.
- Module wrappers: `legal_actions`, `apply_action`, `evaluate_victory`, `get_special_control`, `get_defended_king_preview`, `validate_placement_schedule`.
- Core dataclasses: `GameConfig`, `Piece`, `Action`, `TransitionResult`, `TransitionEvent`, `DefendedKingPreview`, `SpecialControl`, `TerritoryClaim`, `VictoryResult`, `PlacementResult`.
- Reference tests: `tests/test_canonical_engine.py`, currently covering 37 canonical behavior cases.

## Rules To Preserve

- Canonical board defaults to 12x12, Black and White, five Special Squares, Transform disabled.
- Pieces: one King and four each of Attack, Defense and Conquest Pawns per player.
- Normal movement: every piece moves one adjacent empty square in any of eight directions.
- Capture hierarchy: Attack captures Defense/King, Defense captures Conquest, Conquest captures Attack, King captures pawns.
- Attack captures orthogonally at distance one or two. Defense captures diagonally at distance one or two.
- Two-square captures cost both action points, require a clear intermediate square and must be the first action of the turn.
- King can act at most once per turn.
- Defended King attack produces a preview, sacrifices one adjacent friendly Defense Pawn and bounces the Attack Pawn along the engine-provided path.
- Special Square control is owned only by Conquest Pawns standing on Special Squares.
- Territory claim is created on strict majority, gives the opponent one response turn, and matures only if majority remains.
- Transform Square is optional. Pawns on it may transform into a different pawn type; Kings cannot transform.
- Save/load must preserve board, Special/Transform Squares, captured counts and territory claims.

## Transition Events

- `move`: normal movement.
- `capture`: captured player, piece type and location.
- `defended_king`: defended King resolution with king, defender and landing.
- `bounce`: exact bounce path and landing.
- `transform_available`: pawn ended on Transform Square.
- `transform`: pawn type changed and Transform Square relocation data.
- `pass`: turn ended without action.

## Fixture Strategy

`web/scripts/generate_engine_fixtures.py` emits deterministic JSON under `web/tests/fixtures/python-engine-fixtures.json`. TypeScript tests must compare actions, previews, transitions, placement results, victory and serialization against this data before the new engine is treated as authoritative.
