import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "assalto_pygbag_ready"))

from assalto_core import (  # noqa: E402
    Board,
    GameConfig,
    GameHistory,
    Piece,
    RuleError,
    SpecialSquareGenerationError,
    evaluate_victory,
    validate_placement_schedule,
)


def empty_board() -> Board:
    return Board(GameConfig(), generate_specials=False)


def put(board: Board, pos, player: str, ptype: str) -> None:
    board[pos[0]][pos[1]] = Piece.create(ptype, player)


def test_all_pieces_move_one_empty_adjacent_square_in_all_eight_directions():
    for ptype in ("King", "AttackPawn", "DefensePawn", "ConquestPawn"):
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                board = empty_board()
                put(board, (5, 5), "Black", ptype)
                action = board.build_action((5, 5), (5 + dr, 5 + dc))
                assert action.error is None, (ptype, dr, dc, action.error)
                assert action.kind == "move"
                assert action.cost == 1


def test_movement_rejects_boundaries_friendly_and_enemy_non_capture_destinations():
    board = empty_board()
    put(board, (0, 0), "Black", "AttackPawn")
    assert board.build_action((0, 0), (-1, 0)).error == "outside board"

    board = empty_board()
    put(board, (5, 5), "Black", "AttackPawn")
    put(board, (4, 4), "Black", "DefensePawn")
    assert "friendly" in board.build_action((5, 5), (4, 4)).error

    board = empty_board()
    put(board, (5, 5), "Black", "AttackPawn")
    put(board, (4, 4), "White", "AttackPawn")
    assert board.build_action((5, 5), (4, 4)).error is not None


@pytest.mark.parametrize(
    "attacker,target,end",
    [
        ("AttackPawn", "DefensePawn", (5, 6)),
        ("AttackPawn", "King", (5, 6)),
        ("DefensePawn", "ConquestPawn", (6, 6)),
        ("ConquestPawn", "AttackPawn", (6, 6)),
        ("King", "AttackPawn", (6, 6)),
        ("King", "DefensePawn", (6, 6)),
        ("King", "ConquestPawn", (6, 6)),
    ],
)
def test_valid_capture_hierarchy(attacker, target, end):
    board = empty_board()
    put(board, (5, 5), "Black", attacker)
    put(board, end, "White", target)
    action = board.build_action((5, 5), end)
    assert action.error is None
    assert action.kind == "capture"
    assert action.cost == 1


@pytest.mark.parametrize(
    "attacker,target,end",
    [
        ("AttackPawn", "AttackPawn", (5, 6)),
        ("AttackPawn", "ConquestPawn", (5, 6)),
        ("DefensePawn", "AttackPawn", (6, 6)),
        ("DefensePawn", "DefensePawn", (6, 6)),
        ("DefensePawn", "King", (6, 6)),
        ("ConquestPawn", "DefensePawn", (6, 6)),
        ("ConquestPawn", "ConquestPawn", (6, 6)),
        ("ConquestPawn", "King", (6, 6)),
        ("King", "King", (6, 6)),
    ],
)
def test_invalid_capture_hierarchy(attacker, target, end):
    board = empty_board()
    put(board, (5, 5), "Black", attacker)
    put(board, end, "White", target)
    assert board.build_action((5, 5), end).error is not None


def test_two_square_capture_costs_two_requires_first_action_and_clear_intermediate():
    board = empty_board()
    put(board, (5, 3), "Black", "AttackPawn")
    put(board, (5, 5), "White", "DefensePawn")
    action = board.build_action((5, 3), (5, 5), moves_this_turn=0)
    assert action.error is None
    assert action.cost == 2
    assert action.ends_turn

    assert "first action" in board.build_action((5, 3), (5, 5), moves_this_turn=1).error

    put(board, (5, 4), "Black", "ConquestPawn")
    assert "blocked" in board.build_action((5, 3), (5, 5), moves_this_turn=0).error


def test_king_single_action_restriction_is_engine_authored():
    board = empty_board()
    put(board, (5, 5), "Black", "King")
    assert board.build_action((5, 5), (5, 6), king_moved=True).error == "King has already acted this turn"


def test_undefended_king_capture_wins_immediately():
    board = empty_board()
    put(board, (5, 4), "Black", "AttackPawn")
    put(board, (5, 5), "White", "King")
    action = board.build_action((5, 4), (5, 5))
    result = board.apply_action(action)
    assert result.victory is not None
    assert result.victory.winner == "Black"
    assert board[5][5].type == "AttackPawn"


def test_defended_king_one_square_bounce_is_deterministic_and_atomic():
    board = empty_board()
    put(board, (0, 0), "Black", "King")
    put(board, (5, 4), "Black", "AttackPawn")
    put(board, (5, 5), "White", "King")
    put(board, (4, 5), "White", "DefensePawn")

    action = board.build_action((5, 4), (5, 5))
    preview = action.defended_king
    assert preview is not None
    assert preview.attack_direction == (0, 1)
    assert preview.bounce_direction == (0, -1)
    assert preview.landing_position == (5, 0)
    assert preview.action_cost == 1

    result = board.apply_action(action)
    assert result.error is None
    assert result.victory is None
    assert result.ends_turn
    assert board[5][5].type == "King"
    assert board[5][0].type == "AttackPawn"
    assert board[4][5] is None
    assert board.captured_pieces["White"]["DefensePawn"] == 1
    assert board.captured_pieces["White"]["King"] == 0


def test_defended_king_two_square_bounce_treats_intermediate_and_origin_as_available():
    board = empty_board()
    put(board, (0, 0), "Black", "King")
    put(board, (5, 3), "Black", "AttackPawn")
    put(board, (5, 5), "White", "King")
    put(board, (4, 5), "White", "DefensePawn")

    action = board.build_action((5, 3), (5, 5))
    assert action.error is None
    assert action.cost == 2
    assert action.defended_king.bounce_path[:2] == ((5, 4), (5, 3))
    result = board.apply_action(action)
    assert result.ends_turn
    assert board[5][0].type == "AttackPawn"


def test_defended_king_bounce_stops_before_obstacle_without_jumping_or_rotating():
    board = empty_board()
    put(board, (0, 0), "Black", "King")
    put(board, (5, 3), "Black", "AttackPawn")
    put(board, (5, 5), "White", "King")
    put(board, (4, 5), "White", "DefensePawn")
    put(board, (5, 2), "Black", "ConquestPawn")

    action = board.build_action((5, 3), (5, 5))
    assert action.defended_king.landing_position == (5, 3)
    result = board.apply_action(action)
    assert result.error is None
    assert board[5][3].type == "AttackPawn"
    assert board[5][2].type == "ConquestPawn"


def test_multiple_defenders_allow_explicit_sacrifice_choice():
    board = empty_board()
    put(board, (0, 0), "Black", "King")
    put(board, (5, 4), "Black", "AttackPawn")
    put(board, (5, 5), "White", "King")
    put(board, (4, 5), "White", "DefensePawn")
    put(board, (6, 5), "White", "DefensePawn")

    action = board.build_action((5, 4), (5, 5), selected_defender=(6, 5))
    assert len(action.defended_king.eligible_defender_ids) == 2
    board.apply_action(action)
    assert board[6][5] is None
    assert board[4][5].type == "DefensePawn"


def test_only_adjacent_friendly_defense_pawns_protect_the_king():
    board = empty_board()
    put(board, (5, 4), "Black", "AttackPawn")
    put(board, (5, 5), "White", "King")
    put(board, (4, 5), "White", "AttackPawn")
    action = board.build_action((5, 4), (5, 5))
    assert action.defended_king is None
    assert board.apply_action(action).victory.winner == "Black"


def test_preview_landing_equals_actual_landing_save_load_and_undo_restore():
    board = empty_board()
    put(board, (0, 0), "Black", "King")
    put(board, (5, 4), "Black", "AttackPawn")
    put(board, (5, 5), "White", "King")
    put(board, (4, 5), "White", "DefensePawn")
    history = GameHistory()
    history.push(board)
    action = board.build_action((5, 4), (5, 5))
    landing = action.defended_king.landing_position
    board.apply_action(action)
    assert board[landing[0]][landing[1]].type == "AttackPawn"

    restored = Board.from_json(board.to_json())
    assert restored[landing[0]][landing[1]].type == "AttackPawn"
    assert restored[5][5].type == "King"

    assert history.undo(board)
    assert board[5][4].type == "AttackPawn"
    assert board[4][5].type == "DefensePawn"


def test_placement_schedule_and_restrictions():
    assert validate_placement_schedule() == {"Black": 13, "White": 13}
    board = empty_board()
    board.special_squares = {(4, 4)}
    board.transform_squares = {(6, 6)}
    assert board.can_place_piece((5, 2), "Black", "King").ok
    assert not board.can_place_piece((5, 7), "Black", "King").ok
    assert board.can_place_piece((5, 10), "White", "AttackPawn").ok
    assert not board.can_place_piece((5, 9), "White", "AttackPawn").ok
    assert not board.can_place_piece((5, 5), "Black", "ConquestPawn").ok
    assert board.can_place_piece((0, 0), "Black", "DefensePawn").ok
    assert not board.can_place_piece((4, 4), "Black", "DefensePawn").ok
    assert not board.can_place_piece((6, 6), "Black", "DefensePawn").ok


def test_special_square_generation_is_complete_deterministic_and_atomic_on_failure():
    first = Board(GameConfig(), generate_specials=False)
    second = Board(GameConfig(), generate_specials=False)
    assert first.generate_special_squares(5, seed=123) == second.generate_special_squares(5, seed=123)

    tiny = Board(GameConfig(ROWS=3, COLS=3), generate_specials=False)
    tiny.special_squares = {(1, 1)}
    with pytest.raises(SpecialSquareGenerationError):
        tiny._generate_special_squares(5, seed=1)
    assert tiny.special_squares == {(1, 1)}


def test_transform_is_disabled_by_default_and_generation_is_deterministic():
    assert not GameConfig().TRANSFORM_ENABLED

    first = Board(GameConfig(TRANSFORM_ENABLED=True), generate_specials=False)
    second = Board(GameConfig(TRANSFORM_ENABLED=True), generate_specials=False)
    for board in (first, second):
        board.special_squares = {(5, 5)}
        put(board, (4, 4), "Black", "AttackPawn")
        put(board, (4, 8), "White", "ConquestPawn")

    assert first._generate_transform_square(seed=9)
    assert second._generate_transform_square(seed=9)
    assert first.transform_squares == second.transform_squares
    square = next(iter(first.transform_squares))
    assert square not in first.special_squares
    assert first[square[0]][square[1]] is None


def test_transform_available_event_excludes_kings():
    board = Board(GameConfig(TRANSFORM_ENABLED=True), generate_specials=False)
    board.transform_squares = {(5, 6)}
    put(board, (0, 0), "Black", "King")
    put(board, (11, 11), "White", "King")
    put(board, (5, 5), "Black", "AttackPawn")

    result = board.apply_action(board.build_action((5, 5), (5, 6)))
    assert any(ev.kind == "transform_available" for ev in result.events)
    assert not result.ends_turn

    board = Board(GameConfig(TRANSFORM_ENABLED=True), generate_specials=False)
    board.transform_squares = {(5, 6)}
    put(board, (5, 5), "Black", "King")
    put(board, (11, 11), "White", "King")
    result = board.apply_action(board.build_action((5, 5), (5, 6)))
    assert not any(ev.kind == "transform_available" for ev in result.events)


def test_transform_piece_is_engine_authored_and_relocates_square():
    board = Board(GameConfig(TRANSFORM_ENABLED=True), generate_specials=False)
    board.transform_squares = {(5, 6)}
    put(board, (5, 6), "Black", "AttackPawn")
    put(board, (5, 8), "White", "DefensePawn")

    result = board.transform_piece((5, 6), "ConquestPawn", seed=4)
    assert result.error is None
    assert result.ends_turn
    assert board[5][6].type == "ConquestPawn"
    assert board.transform_squares
    assert (5, 6) not in board.transform_squares
    event = result.events[0]
    assert event.kind == "transform"
    assert event.data["old_type"] == "AttackPawn"
    assert event.data["new_type"] == "ConquestPawn"


def test_invalid_transform_requests_are_rejected_without_mutation():
    board = Board(GameConfig(TRANSFORM_ENABLED=True), generate_specials=False)
    board.transform_squares = {(5, 6)}
    put(board, (5, 6), "Black", "AttackPawn")
    assert "different" in board.transform_piece((5, 6), "AttackPawn").error
    assert board[5][6].type == "AttackPawn"

    board = Board(GameConfig(TRANSFORM_ENABLED=True), generate_specials=False)
    board.transform_squares = {(5, 6)}
    put(board, (5, 6), "Black", "King")
    assert "King" in board.transform_piece((5, 6), "DefensePawn").error
    assert board[5][6].type == "King"


def test_defended_king_bounce_can_trigger_transform_available_event():
    board = Board(GameConfig(TRANSFORM_ENABLED=True), generate_specials=False)
    board.transform_squares = {(5, 3)}
    put(board, (0, 0), "Black", "King")
    put(board, (5, 4), "Black", "AttackPawn")
    put(board, (5, 5), "White", "King")
    put(board, (4, 5), "White", "DefensePawn")
    put(board, (5, 2), "Black", "ConquestPawn")

    action = board.build_action((5, 4), (5, 5))
    assert action.defended_king.triggers_transform
    assert action.defended_king.landing_position == (5, 3)
    result = board.apply_action(action)
    assert any(ev.kind == "transform_available" and ev.data["at"] == (5, 3) for ev in result.events)


def test_territory_uses_strict_majority_claims_and_cancels_on_lost_control():
    board = empty_board()
    board.special_squares = {(1, 1), (1, 4), (4, 1), (4, 4), (7, 7)}
    put(board, (1, 1), "Black", "ConquestPawn")
    put(board, (1, 4), "Black", "ConquestPawn")
    put(board, (4, 1), "Black", "ConquestPawn")
    assert board.current_majority_player() == "Black"
    assert board.refresh_territory_claim(turn_counter=1) is None
    assert board.territory_claim.claimant == "Black"
    assert board.refresh_territory_claim(turn_counter=2) is None
    assert board.refresh_territory_claim(turn_counter=3).winner == "Black"

    board = empty_board()
    board.special_squares = {(1, 1), (1, 4), (4, 1), (4, 4), (7, 7)}
    put(board, (1, 1), "Black", "ConquestPawn")
    put(board, (1, 4), "Black", "ConquestPawn")
    put(board, (4, 1), "Black", "ConquestPawn")
    board.refresh_territory_claim(turn_counter=1)
    board[4][1] = None
    assert board.refresh_territory_claim(turn_counter=2) is None
    assert board.territory_claim is None


def test_public_victory_helper_accepts_context():
    board = empty_board()
    put(board, (5, 5), "White", "King")
    result = evaluate_victory(board, last_actor="White")
    assert result.winner == "White"
    assert result.reason == "king_capture"
    assert result.loser == "Black"

    board = empty_board()
    board.special_squares = {(1, 1), (1, 4), (4, 1), (4, 4), (7, 7)}
    put(board, (10, 1), "Black", "King")
    put(board, (10, 10), "White", "King")
    put(board, (1, 1), "Black", "ConquestPawn")
    put(board, (1, 4), "Black", "ConquestPawn")
    put(board, (4, 1), "Black", "ConquestPawn")
    assert evaluate_victory(board, turn_counter=1) is None
    result = evaluate_victory(board, turn_counter=3)
    assert result.winner == "Black"
    assert result.reason == "territory"


def test_legal_actions_are_self_consistent_and_never_apply_illegal_actions():
    board = empty_board()
    put(board, (5, 5), "Black", "AttackPawn")
    put(board, (4, 4), "Black", "DefensePawn")
    put(board, (5, 7), "White", "DefensePawn")
    put(board, (7, 7), "White", "King")
    actions = board.legal_actions("Black", include_pass=False)
    assert actions
    for action in actions:
        clone = board.clone()
        result = clone.apply_action(action)
        assert result.error is None
