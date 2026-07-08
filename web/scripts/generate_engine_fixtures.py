from __future__ import annotations

import json
import sys
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "assalto_pygbag_ready"))

from assalto_core import Board, GameConfig, Piece  # noqa: E402


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
    }
    out = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "python-engine-fixtures.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fixtures, indent=2, sort_keys=True), encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
