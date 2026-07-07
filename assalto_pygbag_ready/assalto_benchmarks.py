from __future__ import annotations

import argparse
import random
import statistics
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple

from assalto_core import Action, Board, GameConfig, Piece, TransitionResult

Vec2 = Tuple[int, int]


PIECE_VALUE = {
    "AttackPawn": 45.0,
    "DefensePawn": 70.0,
    "ConquestPawn": 80.0,
    "King": 10_000.0,
}


@dataclass
class MatchStats:
    winner: str
    reason: str
    turns: int
    illegal_actions: int
    captures: int
    defense_sacrifices: int
    bounces: int
    total_bounce_distance: int
    transform_available: int
    transformations: int
    black_special_control_turns: int
    white_special_control_turns: int


def choose_quick_square(board: Board, player: str, ptype: str, rng: random.Random) -> Optional[Vec2]:
    king = None
    for r in range(board.cfg.ROWS):
        for c in range(board.cfg.COLS):
            piece = board[r][c]
            if piece and piece.player == player and piece.type == "King":
                king = (r, c)
                break
        if king:
            break

    center_r = board.cfg.ROWS // 2
    if ptype == "King":
        anchor = (center_r, board.cfg.COLS // 4 if player == "Black" else (3 * board.cfg.COLS) // 4)
    elif ptype == "AttackPawn":
        anchor = (center_r, 0 if player == "Black" else board.cfg.COLS - 1)
    elif ptype == "DefensePawn" and king is not None:
        anchor = king
    else:
        anchor = (center_r, 2 if player == "Black" else board.cfg.COLS - 3)

    legal: List[Tuple[float, Vec2]] = []
    for r in range(board.cfg.ROWS):
        for c in range(board.cfg.COLS):
            pos = (r, c)
            if not board.can_place_piece(pos, player, ptype).ok:
                continue
            score = -2.0 * (abs(r - anchor[0]) + abs(c - anchor[1]))
            if ptype == "DefensePawn" and king is not None:
                d = max(abs(r - king[0]), abs(c - king[1]))
                score += 80.0 if d == 1 else 20.0 if d == 2 else 0.0
            if ptype == "ConquestPawn" and board.special_squares:
                d = min(max(abs(r - sr), abs(c - sc)) for sr, sc in board.special_squares)
                score += 60.0 / max(1, d)
            score += rng.random() * 0.001
            legal.append((score, pos))
    if not legal:
        return None
    legal.sort(reverse=True)
    return legal[0][1]


def quick_setup(seed: int, *, transform_enabled: bool = False) -> Board:
    rng = random.Random(seed)
    board = Board(GameConfig(TRANSFORM_ENABLED=transform_enabled), seed=seed)
    pieces_left = {
        "Black": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
        "White": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
    }
    for step in Board.PLACEMENT_SCHEDULE:
        for _ in range(step.count):
            ptype = board.next_piece_type_for(step.player, pieces_left)
            if ptype is None:
                raise RuntimeError(f"No piece left for {step.player}")
            pos = choose_quick_square(board, step.player, ptype, rng)
            if pos is None:
                raise RuntimeError(f"No legal placement for {step.player} {ptype}")
            board.place_piece(pos, step.player, ptype)
            pieces_left[step.player][ptype] -= 1
    board.update_control()
    return board


def evaluate(board: Board, player: str) -> float:
    opponent = "White" if player == "Black" else "Black"
    score = 0.0
    for r in range(board.cfg.ROWS):
        for c in range(board.cfg.COLS):
            piece = board[r][c]
            if piece is None:
                continue
            value = PIECE_VALUE[piece.type]
            score += value if piece.player == player else -value
    board.update_control()
    score += 350.0 * (len(board.controlled_squares[player]) - len(board.controlled_squares[opponent]))
    if len(board.controlled_squares[player]) >= board.required_special_majority():
        score += 500.0
    if len(board.controlled_squares[opponent]) >= board.required_special_majority():
        score -= 500.0
    return score


def score_action(board: Board, action: Action, player: str, level: str, rng: random.Random) -> float:
    if action.kind == "pass":
        return -100.0
    clone = board.clone()
    result = clone.apply_action(action)
    if result.error is not None:
        return -1e12
    if result.victory is not None:
        return 1e9 if result.victory.winner == player else -1e9
    score = evaluate(clone, player)
    if action.capture:
        score += PIECE_VALUE.get(action.captured_piece_type or "", 0.0)
    if action.defended_king is not None:
        score -= 35.0
        score += len(action.defended_king.bounce_path)
    if level == "Easy":
        score += rng.random() * 200.0
    elif level == "Hard":
        opponent = "White" if player == "Black" else "Black"
        replies = clone.legal_actions(opponent, include_pass=False)
        if replies:
            reply_scores = [score_action(clone, reply, opponent, "Medium", rng) for reply in replies[:6]]
            score -= 0.35 * max(reply_scores)
    return score


def choose_action(board: Board, player: str, level: str, moves_this_turn: int, king_moved: bool, rng: random.Random) -> Action:
    actions = board.legal_actions(
        player,
        moves_this_turn=moves_this_turn,
        king_moved=king_moved,
        include_pass=True,
    )
    if level == "Random":
        non_pass = [a for a in actions if a.kind != "pass"]
        return rng.choice(non_pass or actions)
    if len(actions) > 36:
        tactical = [a for a in actions if a.capture or a.defended_king is not None]
        quiet = [a for a in actions if a not in tactical and a.kind != "pass"]
        rng.shuffle(quiet)
        actions = tactical + quiet[: max(0, 36 - len(tactical))]
        actions.append(Action("pass", player, ends_turn=True))
    scored = [(score_action(board, action, player, level, rng), action) for action in actions]
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1]


def choose_transform_type(board: Board, pos: Vec2, player: str) -> Optional[str]:
    piece = board[pos[0]][pos[1]]
    if piece is None or piece.type == "King":
        return None
    options = [ptype for ptype in ("AttackPawn", "DefensePawn", "ConquestPawn") if ptype != piece.type]
    if not options:
        return None
    scored: List[Tuple[float, str]] = []
    for ptype in options:
        clone = board.clone()
        clone.grid[pos[0]][pos[1]] = Piece.create(ptype, player)
        clone.update_control()
        scored.append((evaluate(clone, player), ptype))
    scored.sort(reverse=True)
    return scored[0][1]


def simulate_match(
    black_level: str,
    white_level: str,
    seed: int,
    max_turns: int,
    *,
    transform_enabled: bool = False,
) -> MatchStats:
    rng = random.Random(seed)
    board = quick_setup(seed, transform_enabled=transform_enabled)
    current = "Black"
    turns = 0
    illegal = 0
    captures = 0
    defense_sacrifices = 0
    bounces = 0
    total_bounce_distance = 0
    transform_available = 0
    transformations = 0
    black_special_control_turns = 0
    white_special_control_turns = 0

    while turns < max_turns:
        level = black_level if current == "Black" else white_level
        moves_this_turn = 0
        king_moved = False
        while True:
            action = choose_action(board, current, level, moves_this_turn, king_moved, rng)
            result = board.apply_action(action, moves_this_turn=moves_this_turn, king_moved=king_moved)
            if result.error is not None:
                illegal += 1
                break
            captures += sum(1 for event in result.events if event.kind == "capture")
            for event in result.events:
                if event.kind == "capture" and event.data.get("captured_piece_type") == "DefensePawn" and action.defended_king:
                    defense_sacrifices += 1
                if event.kind == "bounce":
                    bounces += 1
                    total_bounce_distance += len(event.data.get("path", ()))
                if event.kind == "transform_available":
                    transform_available += 1
                    pos = event.data["at"]
                    new_type = choose_transform_type(board, pos, current)
                    if new_type is not None:
                        transform = board.transform_piece(pos, new_type, seed=seed + turns + transformations)
                        if transform.error is None:
                            transformations += 1
            if result.victory is not None:
                return MatchStats(
                    result.victory.winner,
                    result.victory.reason,
                    turns + 1,
                    illegal,
                    captures,
                    defense_sacrifices,
                    bounces,
                    total_bounce_distance,
                    transform_available,
                    transformations,
                    black_special_control_turns,
                    white_special_control_turns,
                )
            if result.ends_turn:
                break
            moves_this_turn = result.next_moves_this_turn
            king_moved = result.next_king_moved
            if moves_this_turn >= 2:
                break

        turns += 1
        board.update_control()
        black_special_control_turns += len(board.controlled_squares["Black"])
        white_special_control_turns += len(board.controlled_squares["White"])
        if transform_enabled and turns >= board.cfg.TRANSFORM_ROUND * 2 and not board.transform_squares:
            board._generate_transform_square(seed=seed + turns)
        territory = board.refresh_territory_claim(turn_counter=turns)
        if territory is not None:
            return MatchStats(
                territory.winner,
                territory.reason,
                turns,
                illegal,
                captures,
                defense_sacrifices,
                bounces,
                total_bounce_distance,
                transform_available,
                transformations,
                black_special_control_turns,
                white_special_control_turns,
            )
        current = "White" if current == "Black" else "Black"

    board.update_control()
    winner = "Black" if evaluate(board, "Black") >= evaluate(board, "White") else "White"
    return MatchStats(
        winner,
        "turn_limit",
        turns,
        illegal,
        captures,
        defense_sacrifices,
        bounces,
        total_bounce_distance,
        transform_available,
        transformations,
        black_special_control_turns,
        white_special_control_turns,
    )


def summarize(label: str, stats: List[MatchStats]) -> str:
    black_wins = sum(1 for item in stats if item.winner == "Black")
    white_wins = len(stats) - black_wins
    lengths = [item.turns for item in stats]
    illegal = sum(item.illegal_actions for item in stats)
    captures = sum(item.captures for item in stats)
    sacrifices = sum(item.defense_sacrifices for item in stats)
    bounces = sum(item.bounces for item in stats)
    avg_bounce = (sum(item.total_bounce_distance for item in stats) / bounces) if bounces else 0.0
    transform_available = sum(item.transform_available for item in stats)
    transformations = sum(item.transformations for item in stats)
    black_control = sum(item.black_special_control_turns for item in stats)
    white_control = sum(item.white_special_control_turns for item in stats)
    reasons: Dict[str, int] = {}
    for item in stats:
        reasons[item.reason] = reasons.get(item.reason, 0) + 1
    return (
        f"{label}: games={len(stats)} black_wins={black_wins} white_wins={white_wins} "
        f"avg_len={statistics.mean(lengths):.1f} median_len={statistics.median(lengths):.1f} "
        f"reasons={reasons} captures={captures} defense_sacrifices={sacrifices} "
        f"bounces={bounces} avg_bounce_distance={avg_bounce:.2f} "
        f"transform_available={transform_available} transformations={transformations} "
        f"special_control_turns=Black:{black_control},White:{white_control} illegal_actions={illegal}"
    )


def run_suite(games: int, seed: int, max_turns: int, *, transform_enabled: bool = False) -> List[str]:
    pairs = [
        ("Random", "Easy"),
        ("Easy", "Medium"),
        ("Medium", "Hard"),
        ("Hard", "Medium"),
        ("Hard", "Hard"),
    ]
    lines: List[str] = []
    for index, (black, white) in enumerate(pairs):
        stats = [
            simulate_match(
                black,
                white,
                seed + index * 10_000 + game,
                max_turns,
                transform_enabled=transform_enabled,
            )
            for game in range(games)
        ]
        lines.append(summarize(f"{black} vs {white}", stats))
    return lines


def main() -> None:
    parser = argparse.ArgumentParser(description="Run headless Assalto Reale engine benchmarks.")
    parser.add_argument("--games", type=int, default=4)
    parser.add_argument("--seed", type=int, default=1234)
    parser.add_argument("--max-turns", type=int, default=160)
    parser.add_argument("--transform", action="store_true", help="Enable the optional Transform variant in simulations.")
    args = parser.parse_args()
    for line in run_suite(args.games, args.seed, args.max_turns, transform_enabled=args.transform):
        print(line)


if __name__ == "__main__":
    main()
