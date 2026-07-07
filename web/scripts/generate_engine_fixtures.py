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


def case_simple_move() -> dict[str, Any]:
    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    action = board.build_action((5, 5), (5, 6))
    clone = board.clone()
    result = clone.apply_action(action)
    return {
        "name": "simple_move",
        "initial": board.to_dict(),
        "input": {"start": [5, 5], "end": [5, 6], "moves_this_turn": 0, "king_moved": False},
        "action": encode(action),
        "result": encode(result),
        "final": clone.to_dict(),
    }


def case_two_square_capture() -> dict[str, Any]:
    board = Board(GameConfig(), generate_specials=False)
    put(board, (5, 5), "Black", "AttackPawn")
    put(board, (5, 7), "White", "DefensePawn")
    action = board.build_action((5, 5), (5, 7))
    clone = board.clone()
    result = clone.apply_action(action)
    return {
        "name": "two_square_capture",
        "initial": board.to_dict(),
        "input": {"start": [5, 5], "end": [5, 7], "moves_this_turn": 0, "king_moved": False},
        "action": encode(action),
        "result": encode(result),
        "final": clone.to_dict(),
    }


def case_defended_king() -> dict[str, Any]:
    board = Board(GameConfig(), generate_specials=False)
    board.transform_squares = {(5, 1)}
    put(board, (5, 2), "Black", "AttackPawn")
    put(board, (4, 3), "White", "DefensePawn")
    put(board, (5, 3), "White", "King")
    action = board.build_action((5, 2), (5, 3), selected_defender=(4, 3))
    clone = board.clone()
    result = clone.apply_action(action)
    return {
        "name": "defended_king",
        "initial": board.to_dict(),
        "input": {
            "start": [5, 2],
            "end": [5, 3],
            "moves_this_turn": 0,
            "king_moved": False,
            "selected_defender": [4, 3],
        },
        "action": encode(action),
        "preview": encode(action.defended_king),
        "result": encode(result),
        "final": clone.to_dict(),
    }


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
