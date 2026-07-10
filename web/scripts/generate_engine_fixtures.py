from __future__ import annotations

import json
import sys
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "assalto_pygbag_ready"))

from assalto_core import Action, Board, GameConfig, Piece  # noqa: E402
from assalto_prng import Mulberry32  # noqa: E402


def encode(value: Any) -> Any:
    if is_dataclass(value):
        return encode(asdict(value))
    if isinstance(value, tuple):
        return [encode(item) for item in value]
    if isinstance(value, list):
        return [encode(item) for item in value]
    if isinstance(value, set):
        return sorted(encode(item) for item in value)
    if isinstance(value, dict):
        return {key: encode(item) for key, item in value.items()}
    return value


def put(board: Board, pos: tuple[int, int], player: str, ptype: str) -> None:
    board[pos[0]][pos[1]] = Piece.create(ptype, player)


def action_case(
    name: str,
    board: Board,
    start: tuple[int, int],
    end: tuple[int, int],
    *,
    moves_this_turn: int = 0,
    king_moved: bool = False,
    selected_defender: tuple[int, int] | None = None,
) -> dict[str, Any]:
    action = board.build_action(
        start,
        end,
        moves_this_turn=moves_this_turn,
        king_moved=king_moved,
        selected_defender=selected_defender,
    )
    clone = board.clone()
    result = clone.apply_action(action, moves_this_turn=moves_this_turn, king_moved=king_moved)
    input_data: dict[str, Any] = {
        "start": start,
        "end": end,
        "moves_this_turn": moves_this_turn,
        "king_moved": king_moved,
    }
    if selected_defender is not None:
        input_data["selected_defender"] = selected_defender
    return {
        "name": name,
        "kind": "action",
        "initial": board.to_dict(),
        "input": encode(input_data),
        "action": encode(action),
        "preview": encode(action.defended_king),
        "result": encode(result),
        "final": clone.to_dict(),
    }


def case_simple_move() -> dict[str, Any]:
    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    return action_case("simple_move", board, (5, 5), (5, 6))


def case_two_square_capture() -> dict[str, Any]:
    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    put(board, (5, 7), "White", "DefensePawn")
    return action_case("two_square_capture", board, (5, 5), (5, 7))


def case_defended_king() -> dict[str, Any]:
    board = Board(GameConfig(), generate_specials=False)
    board.transform_squares = {(5, 1)}
    put(board, (5, 2), "Black", "AttackPawn")
    put(board, (4, 3), "White", "DefensePawn")
    put(board, (5, 3), "White", "King")
    return action_case("defended_king", board, (5, 2), (5, 3), selected_defender=(4, 3))


def movement_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for ptype in ("King", "AttackPawn", "DefensePawn", "ConquestPawn"):
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                board = Board(GameConfig(), generate_specials=False)
                put(board, (5, 5), "Black", ptype)
                cases.append(action_case(f"move_{ptype}_{dr}_{dc}", board, (5, 5), (5 + dr, 5 + dc)))
    return cases


def invalid_movement_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []

    board = Board(GameConfig(), generate_specials=False)
    put(board, (0, 0), "Black", "AttackPawn")
    cases.append(action_case("move_outside_board", board, (0, 0), (-1, 0)))

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    put(board, (4, 4), "Black", "DefensePawn")
    cases.append(action_case("move_friendly_destination", board, (5, 5), (4, 4)))

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    cases.append(action_case("move_long_empty_destination", board, (5, 5), (5, 7)))

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    cases.append(action_case("move_no_action_points", board, (5, 5), (5, 6), moves_this_turn=2))

    return cases


def capture_hierarchy_cases() -> list[dict[str, Any]]:
    legal = [
        ("AttackPawn", "DefensePawn", (5, 6)),
        ("AttackPawn", "King", (5, 6)),
        ("DefensePawn", "ConquestPawn", (6, 6)),
        ("ConquestPawn", "AttackPawn", (6, 6)),
        ("King", "AttackPawn", (6, 6)),
        ("King", "DefensePawn", (6, 6)),
        ("King", "ConquestPawn", (6, 6)),
    ]
    illegal = [
        ("AttackPawn", "AttackPawn", (5, 6)),
        ("AttackPawn", "ConquestPawn", (5, 6)),
        ("DefensePawn", "AttackPawn", (6, 6)),
        ("DefensePawn", "DefensePawn", (6, 6)),
        ("DefensePawn", "King", (6, 6)),
        ("ConquestPawn", "DefensePawn", (6, 6)),
        ("ConquestPawn", "ConquestPawn", (6, 6)),
        ("ConquestPawn", "King", (6, 6)),
        ("King", "King", (6, 6)),
    ]
    cases: list[dict[str, Any]] = []
    for attacker, target, end in legal:
        board = Board(GameConfig(), generate_specials=False)
        put(board, (5, 5), "Black", attacker)
        put(board, end, "White", target)
        cases.append(action_case(f"capture_legal_{attacker}_takes_{target}", board, (5, 5), end))
    for attacker, target, end in illegal:
        board = Board(GameConfig(), generate_specials=False)
        put(board, (5, 5), "Black", attacker)
        put(board, end, "White", target)
        cases.append(action_case(f"capture_illegal_{attacker}_takes_{target}", board, (5, 5), end))
    return cases


def range_capture_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 3), "Black", "AttackPawn")
    put(board, (5, 5), "White", "DefensePawn")
    cases.append(action_case("attack_two_square_clear", board, (5, 3), (5, 5)))
    cases.append(action_case("attack_two_square_after_first_action", board, (5, 3), (5, 5), moves_this_turn=1))

    blocked = board.clone()
    put(blocked, (5, 4), "Black", "ConquestPawn")
    cases.append(action_case("attack_two_square_blocked", blocked, (5, 3), (5, 5)))

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 3), "Black", "DefensePawn")
    put(board, (7, 5), "White", "ConquestPawn")
    cases.append(action_case("defense_two_square_clear", board, (5, 3), (7, 5)))
    cases.append(action_case("defense_two_square_after_first_action", board, (5, 3), (7, 5), moves_this_turn=1))

    blocked = board.clone()
    put(blocked, (6, 4), "Black", "AttackPawn")
    cases.append(action_case("defense_two_square_blocked", blocked, (5, 3), (7, 5)))

    return cases


def king_restriction_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "King")
    cases.append(action_case("king_first_action", board, (5, 5), (5, 6)))
    cases.append(action_case("king_second_action_rejected", board, (5, 5), (5, 6), king_moved=True))

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 4), "Black", "AttackPawn")
    put(board, (5, 5), "White", "King")
    cases.append(action_case("king_capture_victory", board, (5, 4), (5, 5)))
    return cases


def case_placement() -> dict[str, Any]:
    board = Board(GameConfig(), generate_specials=False)
    board.special_squares = {(4, 4)}
    checks = [
        {"pos": [5, 1], "player": "Black", "ptype": "King", "result": encode(board.can_place_piece((5, 1), "Black", "King"))},
        {"pos": [5, 8], "player": "Black", "ptype": "King", "result": encode(board.can_place_piece((5, 8), "Black", "King"))},
        {"pos": [5, 2], "player": "Black", "ptype": "AttackPawn", "result": encode(board.can_place_piece((5, 2), "Black", "AttackPawn"))},
        {"pos": [4, 4], "player": "Black", "ptype": "ConquestPawn", "result": encode(board.can_place_piece((4, 4), "Black", "ConquestPawn"))},
    ]
    return {"name": "placement_restrictions", "initial": board.to_dict(), "checks": checks}


def case_territory() -> dict[str, Any]:
    board = Board(GameConfig(), generate_specials=False)
    board.special_squares = {(1, 1), (1, 4), (4, 1), (4, 4), (7, 7)}
    put(board, (10, 1), "Black", "King")
    put(board, (10, 10), "White", "King")
    put(board, (1, 1), "Black", "ConquestPawn")
    put(board, (1, 4), "Black", "ConquestPawn")
    put(board, (4, 1), "Black", "ConquestPawn")
    first = board.refresh_territory_claim(turn_counter=1)
    second = board.refresh_territory_claim(turn_counter=3)
    return {
        "name": "territory_claim",
        "final": board.to_dict(),
        "first": encode(first),
        "second": encode(second),
        "control": encode(board.get_special_control()),
    }


PRNG_SEEDS = [0, 1, 7, 42, 123, 2024, 999999, 2654435761, 4294967295]


def prng_sequence_cases() -> list[dict[str, Any]]:
    """Raw Mulberry32 output — the lowest-level cross-runtime proof that the
    shared PRNG is byte-identical in Python and TypeScript."""
    cases: list[dict[str, Any]] = []
    for seed in PRNG_SEEDS:
        rng = Mulberry32(seed)
        cases.append({"seed": seed, "values": [rng.random() for _ in range(8)]})
    return cases


def special_generation_cases() -> list[dict[str, Any]]:
    """Seeded Special Square generation on the default board for several seeds."""
    cases: list[dict[str, Any]] = []
    for seed in [1, 7, 42, 123, 2024, 999999]:
        board = Board(GameConfig(), generate_specials=False)
        squares = board.generate_special_squares(board.cfg.SPECIAL_COUNT, seed=seed)
        cases.append(
            {
                "name": f"special_seed_{seed}",
                "seed": seed,
                "count": board.cfg.SPECIAL_COUNT,
                "initial": board.to_dict(),
                "squares": sorted([r, c] for r, c in squares),
            }
        )
    return cases


def transform_generation_cases() -> list[dict[str, Any]]:
    """Seeded Transform Square selection over a fixed, non-trivial candidate set."""
    cases: list[dict[str, Any]] = []
    for seed in [1, 7, 42, 123, 2024]:
        board = Board(GameConfig(TRANSFORM_ENABLED=True), generate_specials=False)
        put(board, (6, 3), "Black", "AttackPawn")
        put(board, (6, 9), "White", "AttackPawn")
        initial = board.to_dict()
        generated = board._generate_transform_square(seed=seed)
        square = sorted(board.transform_squares)[0] if board.transform_squares else None
        cases.append(
            {
                "name": f"transform_seed_{seed}",
                "seed": seed,
                "initial": initial,
                "generated": generated,
                "square": list(square) if square else None,
            }
        )
    return cases


# ---------------------------------------------------------------------------
# Sequence / complete-turn parity harness
#
# A scenario applies a list of steps to one board, threading action points and
# King-acted state exactly as the engine reports them (`next_moves_this_turn` /
# `next_king_moved`), and records, per step, the legal-action set, the built
# action, the transition result and the resulting normalized snapshot. The
# TypeScript replayer (sequenceParity.test.ts) re-threads the same driving steps
# through its engine and must reproduce every recorded value.
# ---------------------------------------------------------------------------


def compact_snapshot(board: Board) -> dict[str, Any]:
    """A compact, lossless projection of the authoritative board state used for
    per-step comparison: the full grid is replaced by a row-major sparse piece
    list (the grid is fully determined by it), keeping the committed fixture
    small. `initial` snapshots stay full (fromPythonSnapshot needs the grid)."""
    data = board.to_dict()
    pieces = []
    for r, row in enumerate(data["grid"]):
        for c, cell in enumerate(row):
            if cell:
                pieces.append([r, c, cell["player"], cell["type"]])
    return {
        "config": data["config"],
        "pieces": pieces,
        "special_squares": data["special_squares"],
        "transform_squares": data["transform_squares"],
        "controlled_squares": data.get("controlled_squares"),
        "captured_pieces": data.get("captured_pieces"),
        "territory_claim": data.get("territory_claim"),
    }


def _sort_key(action: dict[str, Any]) -> tuple:
    start = tuple(action.get("start") or (-1, -1))
    end = tuple(action.get("end") or (-1, -1))
    return (str(action.get("kind")), start, end)


def encode_legal_actions(board: Board, player: str, moves_this_turn: int, king_moved: bool) -> list[dict[str, Any]]:
    actions = board.legal_actions(player, moves_this_turn=moves_this_turn, king_moved=king_moved)
    encoded = [encode(action) for action in actions]
    encoded.sort(key=_sort_key)
    return encoded


def run_scenario(
    name: str,
    category: str,
    board: Board,
    steps: list[dict[str, Any]],
    *,
    seed: int | None = None,
    parity: str = "exact",
    record_legal: bool = True,
) -> dict[str, Any]:
    initial = board.to_dict()
    moves_this_turn = 0
    king_moved = False
    recorded: list[dict[str, Any]] = []

    for step in steps:
        kind = step["kind"]
        if step.get("reset_turn"):
            moves_this_turn, king_moved = 0, False

        if kind == "action":
            start = tuple(step["start"])
            end = tuple(step["end"])
            selected = tuple(step["selected_defender"]) if step.get("selected_defender") else None
            piece = board.grid[start[0]][start[1]]
            player = piece.player if piece else None
            entry: dict[str, Any] = {
                "kind": "action",
                "start": list(start),
                "end": list(end),
                "input": {"moves_this_turn": moves_this_turn, "king_moved": king_moved},
            }
            if selected is not None:
                entry["selected_defender"] = list(selected)
            if step.get("reset_turn"):
                entry["reset_turn"] = True
            if record_legal and player is not None:
                entry["legal_actions"] = encode_legal_actions(board, player, moves_this_turn, king_moved)
            action = board.build_action(start, end, moves_this_turn=moves_this_turn, king_moved=king_moved, selected_defender=selected)
            result = board.apply_action(action, moves_this_turn=moves_this_turn, king_moved=king_moved)
            entry["action"] = encode(action)
            entry["result"] = encode(result)
            entry["snapshot"] = compact_snapshot(board)
            recorded.append(entry)
            moves_this_turn, king_moved = result.next_moves_this_turn, result.next_king_moved

        elif kind == "pass":
            player = step["player"]
            entry = {
                "kind": "pass",
                "player": player,
                "input": {"moves_this_turn": moves_this_turn, "king_moved": king_moved},
            }
            if step.get("reset_turn"):
                entry["reset_turn"] = True
            action = Action("pass", player, ends_turn=True)
            result = board.apply_action(action, moves_this_turn=moves_this_turn, king_moved=king_moved)
            entry["action"] = encode(action)
            entry["result"] = encode(result)
            entry["snapshot"] = compact_snapshot(board)
            recorded.append(entry)
            moves_this_turn, king_moved = result.next_moves_this_turn, result.next_king_moved

        elif kind == "transform":
            pos = tuple(step["pos"])
            new_type = step["new_type"]
            step_seed = step.get("seed", seed)
            result = board.transform_piece(pos, new_type, seed=step_seed)
            recorded.append(
                {
                    "kind": "transform",
                    "pos": list(pos),
                    "new_type": new_type,
                    "seed": step_seed,
                    "result": encode(result),
                    "snapshot": compact_snapshot(board),
                }
            )
            moves_this_turn, king_moved = 0, False

        elif kind == "refresh_territory":
            turn = step["turn"]
            victory = board.refresh_territory_claim(turn_counter=turn)
            recorded.append(
                {
                    "kind": "refresh_territory",
                    "turn": turn,
                    "victory": encode(victory),
                    "snapshot": compact_snapshot(board),
                }
            )

        else:  # pragma: no cover - guards fixture authoring mistakes
            raise ValueError(f"Unknown step kind: {kind}")

    return {
        "name": name,
        "category": category,
        "parity": parity,
        "version": 1,
        "seed": seed,
        "initial": initial,
        "steps": recorded,
    }


def complete_turn_scenarios() -> list[dict[str, Any]]:
    scenarios: list[dict[str, Any]] = []

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    scenarios.append(
        run_scenario(
            "turn_same_piece_two_moves",
            "complete_turn",
            board,
            [{"kind": "action", "start": [5, 5], "end": [5, 6]}, {"kind": "action", "start": [5, 6], "end": [5, 7]}],
        )
    )

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    put(board, (7, 7), "Black", "DefensePawn")
    scenarios.append(
        run_scenario(
            "turn_two_pieces_two_moves",
            "complete_turn",
            board,
            [{"kind": "action", "start": [5, 5], "end": [5, 6]}, {"kind": "action", "start": [7, 7], "end": [6, 6]}],
        )
    )

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    scenarios.append(
        run_scenario(
            "turn_move_then_pass",
            "complete_turn",
            board,
            [{"kind": "action", "start": [5, 5], "end": [5, 6]}, {"kind": "pass", "player": "Black"}],
        )
    )

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    scenarios.append(run_scenario("turn_full_pass", "complete_turn", board, [{"kind": "pass", "player": "Black"}]))

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    put(board, (5, 7), "White", "DefensePawn")
    scenarios.append(
        run_scenario(
            "turn_move_then_capture",
            "complete_turn",
            board,
            [{"kind": "action", "start": [5, 5], "end": [4, 5]}, {"kind": "action", "start": [4, 5], "end": [4, 6]}],
        )
    )

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    put(board, (5, 6), "White", "DefensePawn")
    scenarios.append(
        run_scenario(
            "turn_capture_range_one_ends",
            "complete_turn",
            board,
            [{"kind": "action", "start": [5, 5], "end": [5, 6]}, {"kind": "action", "start": [5, 6], "end": [5, 7]}],
        )
    )

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "King")
    put(board, (7, 7), "Black", "AttackPawn")
    scenarios.append(
        run_scenario(
            "turn_king_then_pawn",
            "complete_turn",
            board,
            [{"kind": "action", "start": [5, 5], "end": [5, 6]}, {"kind": "action", "start": [7, 7], "end": [7, 6]}],
        )
    )

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "King")
    scenarios.append(
        run_scenario(
            "turn_second_king_action_rejected",
            "complete_turn",
            board,
            [{"kind": "action", "start": [5, 5], "end": [5, 6]}, {"kind": "action", "start": [5, 6], "end": [5, 7]}],
        )
    )

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    scenarios.append(
        run_scenario(
            "turn_reset_after_two_actions",
            "complete_turn",
            board,
            [
                {"kind": "action", "start": [5, 5], "end": [5, 6]},
                {"kind": "action", "start": [5, 6], "end": [5, 7]},
                {"kind": "action", "start": [5, 7], "end": [5, 8]},
            ],
        )
    )

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    put(board, (8, 8), "White", "AttackPawn")
    scenarios.append(
        run_scenario(
            "turn_boundary_player_change_and_reset",
            "complete_turn",
            board,
            [
                {"kind": "action", "start": [5, 5], "end": [5, 6]},
                {"kind": "pass", "player": "Black"},
                {"kind": "action", "start": [8, 8], "end": [8, 7], "reset_turn": True},
            ],
        )
    )

    return scenarios


def defended_king_scenarios() -> list[dict[str, Any]]:
    scenarios: list[dict[str, Any]] = []

    def base_board() -> Board:
        board = Board(GameConfig(), generate_specials=False)
        put(board, (5, 2), "Black", "AttackPawn")
        put(board, (4, 3), "White", "DefensePawn")
        put(board, (5, 3), "White", "King")
        return board

    board = base_board()
    board.transform_squares = {(5, 1)}
    scenarios.append(
        run_scenario("dk_single_defender", "defended_king", board, [{"kind": "action", "start": [5, 2], "end": [5, 3], "selected_defender": [4, 3]}])
    )

    for defender in ([4, 3], [6, 3]):
        board = base_board()
        put(board, (6, 3), "White", "DefensePawn")
        scenarios.append(
            run_scenario(
                f"dk_two_defenders_select_{defender[0]}_{defender[1]}",
                "defended_king",
                board,
                [{"kind": "action", "start": [5, 2], "end": [5, 3], "selected_defender": defender}],
            )
        )

    board = base_board()
    scenarios.append(
        run_scenario(
            "dk_invalid_defender",
            "defended_king",
            board,
            [{"kind": "action", "start": [5, 2], "end": [5, 3], "selected_defender": [0, 0]}],
        )
    )

    # Bounce blocked one square short by an occupant (no transform square).
    board = base_board()
    put(board, (5, 0), "Black", "ConquestPawn")
    scenarios.append(
        run_scenario(
            "dk_bounce_blocked",
            "defended_king",
            board,
            [{"kind": "action", "start": [5, 2], "end": [5, 3], "selected_defender": [4, 3]}],
        )
    )

    # Bounce lands exactly on a Transform Square (blocked one beyond it).
    board = base_board()
    board.transform_squares = {(5, 1)}
    put(board, (5, 0), "Black", "ConquestPawn")
    scenarios.append(
        run_scenario(
            "dk_landing_on_transform",
            "defended_king",
            board,
            [{"kind": "action", "start": [5, 2], "end": [5, 3], "selected_defender": [4, 3]}],
        )
    )

    # Range-2 defended attack (clear intermediate, first action of the turn).
    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 1), "Black", "AttackPawn")
    put(board, (4, 3), "White", "DefensePawn")
    put(board, (5, 3), "White", "King")
    scenarios.append(
        run_scenario(
            "dk_range_two",
            "defended_king",
            board,
            [{"kind": "action", "start": [5, 1], "end": [5, 3], "selected_defender": [4, 3]}],
        )
    )

    return scenarios


def transform_scenarios() -> list[dict[str, Any]]:
    scenarios: list[dict[str, Any]] = []

    def stage() -> Board:
        board = Board(GameConfig(TRANSFORM_ENABLED=True), generate_specials=False)
        board.transform_squares = {(5, 5)}
        put(board, (5, 4), "Black", "AttackPawn")
        put(board, (8, 8), "White", "DefensePawn")
        put(board, (8, 2), "White", "AttackPawn")
        return board

    for new_type, seed in (("DefensePawn", 7), ("ConquestPawn", 42)):
        board = stage()
        scenarios.append(
            run_scenario(
                f"transform_move_then_{new_type.lower()}",
                "transform",
                board,
                [
                    {"kind": "action", "start": [5, 4], "end": [5, 5]},
                    {"kind": "transform", "pos": [5, 5], "new_type": new_type, "seed": seed},
                ],
                seed=seed,
            )
        )

    # No opposing pawns of different players near candidates -> relocation fails.
    board = Board(GameConfig(TRANSFORM_ENABLED=True), generate_specials=False)
    board.transform_squares = {(5, 5)}
    put(board, (5, 4), "Black", "AttackPawn")
    scenarios.append(
        run_scenario(
            "transform_no_relocation",
            "transform",
            board,
            [
                {"kind": "action", "start": [5, 4], "end": [5, 5]},
                {"kind": "transform", "pos": [5, 5], "new_type": "DefensePawn", "seed": 7},
            ],
            seed=7,
        )
    )

    return scenarios


def territory_scenarios() -> list[dict[str, Any]]:
    scenarios: list[dict[str, Any]] = []
    specials = {(1, 1), (1, 4), (4, 1), (4, 4), (7, 7)}

    def controlled_board() -> Board:
        board = Board(GameConfig(), generate_specials=False)
        board.special_squares = set(specials)
        put(board, (10, 1), "Black", "King")
        put(board, (10, 10), "White", "King")
        put(board, (1, 1), "Black", "ConquestPawn")
        put(board, (1, 4), "Black", "ConquestPawn")
        put(board, (4, 1), "Black", "ConquestPawn")
        board.update_control()
        return board

    board = controlled_board()
    scenarios.append(
        run_scenario(
            "territory_create_progress_mature",
            "territory",
            board,
            [
                {"kind": "refresh_territory", "turn": 1},
                {"kind": "refresh_territory", "turn": 2},
                {"kind": "refresh_territory", "turn": 3},
            ],
        )
    )

    board = controlled_board()
    scenarios.append(
        run_scenario(
            "territory_cancelled_by_move",
            "territory",
            board,
            [
                {"kind": "refresh_territory", "turn": 1},
                {"kind": "action", "start": [1, 1], "end": [2, 1]},
                {"kind": "refresh_territory", "turn": 2},
            ],
        )
    )

    board = controlled_board()
    put(board, (2, 1), "White", "AttackPawn")
    scenarios.append(
        run_scenario(
            "territory_cancelled_by_capture",
            "territory",
            board,
            [
                {"kind": "refresh_territory", "turn": 1},
                {"kind": "action", "start": [2, 1], "end": [1, 1]},
                {"kind": "refresh_territory", "turn": 2},
            ],
        )
    )

    return scenarios


def victory_scenarios() -> list[dict[str, Any]]:
    scenarios: list[dict[str, Any]] = []

    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 4), "Black", "AttackPawn")
    put(board, (5, 5), "White", "King")
    scenarios.append(
        run_scenario(
            "victory_king_capture",
            "victory",
            board,
            [{"kind": "action", "start": [5, 4], "end": [5, 5]}],
        )
    )

    # King capture must take precedence even when a territory majority is held.
    board = Board(GameConfig(), generate_specials=False)
    board.special_squares = {(1, 1), (1, 4), (4, 1), (4, 4), (7, 7)}
    put(board, (1, 1), "Black", "ConquestPawn")
    put(board, (1, 4), "Black", "ConquestPawn")
    put(board, (4, 1), "Black", "ConquestPawn")
    put(board, (5, 4), "Black", "AttackPawn")
    put(board, (5, 5), "White", "King")
    put(board, (10, 10), "Black", "King")
    board.update_control()
    scenarios.append(
        run_scenario(
            "victory_precedence_king_over_territory",
            "victory",
            board,
            [
                {"kind": "refresh_territory", "turn": 1},
                {"kind": "action", "start": [5, 4], "end": [5, 5]},
            ],
        )
    )

    return scenarios


def generated_initial_board() -> Board:
    board = Board(GameConfig(), generate_specials=False)
    board.special_squares = {(2, 2), (2, 9), (9, 2)}
    put(board, (6, 3), "Black", "King")
    put(board, (4, 4), "Black", "AttackPawn")
    put(board, (7, 5), "Black", "DefensePawn")
    put(board, (2, 2), "Black", "ConquestPawn")
    put(board, (6, 8), "White", "King")
    put(board, (4, 7), "White", "AttackPawn")
    put(board, (8, 6), "White", "DefensePawn")
    put(board, (2, 9), "White", "ConquestPawn")
    board.update_control()
    return board


def generate_legal_scenario(seed: int, max_turns: int = 3) -> dict[str, Any]:
    """Deterministically drive a bounded sequence of legal full turns with the
    shared PRNG, recording each step exactly like run_scenario. Both engines
    replay the same recorded choices; the seed makes any failure reproducible."""
    board = generated_initial_board()
    initial = board.to_dict()
    rng = Mulberry32(seed)
    recorded: list[dict[str, Any]] = []
    player = "Black"
    moves_this_turn, king_moved = 0, False
    turn_counter = 1
    turns_done = 0
    first_step_of_turn = True
    guard = 0

    while turns_done < max_turns and guard < 80:
        guard += 1
        legal = board.legal_actions(player, moves_this_turn=moves_this_turn, king_moved=king_moved)
        action = legal[rng.random_int(len(legal))]

        if action.kind == "pass":
            entry: dict[str, Any] = {"kind": "pass", "player": player, "input": {"moves_this_turn": moves_this_turn, "king_moved": king_moved}}
        else:
            # Legal-action-set parity is asserted on the curated small-board
            # scenarios; generated scenarios omit it to keep the committed
            # fixture compact (they still assert action/result/snapshot per step).
            entry = {
                "kind": "action",
                "start": list(action.start),
                "end": list(action.end),
                "input": {"moves_this_turn": moves_this_turn, "king_moved": king_moved},
            }
        if first_step_of_turn and recorded:
            entry["reset_turn"] = True
            moves_this_turn, king_moved = 0, False
        first_step_of_turn = False

        result = board.apply_action(action, moves_this_turn=moves_this_turn, king_moved=king_moved)
        entry["action"] = encode(action)
        entry["result"] = encode(result)
        entry["snapshot"] = compact_snapshot(board)
        recorded.append(entry)
        moves_this_turn, king_moved = result.next_moves_this_turn, result.next_king_moved

        if result.victory is not None:
            break

        if result.ends_turn:
            victory = board.refresh_territory_claim(turn_counter=turn_counter)
            recorded.append({"kind": "refresh_territory", "turn": turn_counter, "victory": encode(victory), "snapshot": compact_snapshot(board)})
            if victory is not None:
                break
            turn_counter += 1
            turns_done += 1
            player = "White" if player == "Black" else "Black"
            moves_this_turn, king_moved = 0, False
            first_step_of_turn = True

    return {
        "name": f"generated_seed_{seed}",
        "category": "generated",
        "parity": "exact",
        "version": 1,
        "seed": seed,
        "max_turns": max_turns,
        "initial": initial,
        "steps": recorded,
    }


def generated_scenarios() -> list[dict[str, Any]]:
    # 30 deterministic seeds, two full turns each — enough varied legal
    # sequences to be a strong regression net while keeping the committed
    # fixture compact. The seed is in each scenario name for reproducibility.
    return [generate_legal_scenario(seed, max_turns=2) for seed in range(30)]


def main() -> None:
    fixtures = {
        "schema": 1,
        "generated_by": "web/scripts/generate_engine_fixtures.py",
        "cases": [
            case_simple_move(),
            case_two_square_capture(),
            case_defended_king(),
            *movement_cases(),
            *invalid_movement_cases(),
            *capture_hierarchy_cases(),
            *range_capture_cases(),
            *king_restriction_cases(),
            case_placement(),
            case_territory(),
        ],
        "prng": prng_sequence_cases(),
        "special_generation": special_generation_cases(),
        "transform_generation": transform_generation_cases(),
        "scenarios": [
            *complete_turn_scenarios(),
            *defended_king_scenarios(),
            *transform_scenarios(),
            *territory_scenarios(),
            *victory_scenarios(),
            *generated_scenarios(),
        ],
    }
    default_out = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "python-engine-fixtures.json"
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else default_out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fixtures, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
