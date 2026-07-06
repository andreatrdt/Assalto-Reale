from __future__ import annotations

import copy
import json
import os
import random
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

Vec2 = Tuple[int, int]
PieceId = str
Direction = Vec2

PLAYERS: Tuple[str, str] = ("Black", "White")
PAWN_TYPES: Tuple[str, str, str] = ("AttackPawn", "DefensePawn", "ConquestPawn")
PIECE_TYPES: Tuple[str, str, str, str] = ("AttackPawn", "DefensePawn", "ConquestPawn", "King")
ADJACENT_8: Tuple[Vec2, ...] = (
    (-1, -1), (-1, 0), (-1, 1),
    (0, -1),           (0, 1),
    (1, -1),  (1, 0),  (1, 1),
)
ORTHOGONAL_4: Tuple[Vec2, ...] = ((-1, 0), (1, 0), (0, -1), (0, 1))
DIAGONAL_4: Tuple[Vec2, ...] = ((-1, -1), (-1, 1), (1, -1), (1, 1))


class RuleError(ValueError):
    """Raised when a requested state transition is not legal."""


class SpecialSquareGenerationError(RuleError):
    """Raised when special-square generation cannot complete atomically."""


@dataclass(frozen=True)
class GameConfig:
    """Runtime configuration shared by the engine and the Pygame shell.

    The rule defaults are canonical: 12x12 board, five Special Squares, two
    players, and the Transform variant disabled unless a caller enables it.
    UI colors remain here for backwards compatibility with the existing
    renderer; the engine itself does not import Pygame.
    """

    WIDTH: int = 1000
    HEIGHT: int = 812
    ROWS: int = 12
    COLS: int = 12
    SPECIAL_COUNT: int = 5
    TRANSFORM_ENABLED: bool = False
    TRANSFORM_ROUND: int = 10

    RIGHT_MARGIN: int = 240
    SQ_SIZE: int = 1000 // (12 + 4)

    WHITE: Tuple[int, int, int] = (255, 255, 255)
    BLACK: Tuple[int, int, int] = (0, 0, 0)
    LIGHT_BROWN: Tuple[int, int, int] = (222, 184, 135)
    DARK_BROWN: Tuple[int, int, int] = (139, 69, 19)
    GREEN: Tuple[int, int, int] = (61, 77, 48)
    HIGHLIGHT: Tuple[int, int, int] = (136, 136, 136)
    RED_HIGHLIGHT: Tuple[int, int, int] = (255, 0, 0)
    GRAY: Tuple[int, int, int] = (99, 102, 106)
    BUTTON_COLOR: Tuple[int, int, int] = (125, 125, 125)

    FLASH_DURATION: float = 2.0
    BLINK_INTERVAL: float = 1.0

    ASSETS_DIR: str = field(default_factory=lambda: os.path.join(os.path.dirname(__file__), "assets"))


@dataclass
class Piece:
    player: str
    type: str

    def valid_move(self, board: "Board", start: Vec2, end: Vec2, moves_this_turn: int) -> bool:
        """Compatibility wrapper around the authoritative action builder."""
        return board.build_action(start, end, moves_this_turn=moves_this_turn).error is None

    @staticmethod
    def create(ptype: str, player: str) -> "Piece":
        if player not in PLAYERS:
            raise RuleError(f"Unsupported player: {player}")
        cls_map = {
            "AttackPawn": AttackPawn,
            "DefensePawn": DefensePawn,
            "ConquestPawn": ConquestPawn,
            "King": King,
        }
        try:
            return cls_map[ptype](player, ptype)  # type: ignore[misc]
        except KeyError as exc:
            raise RuleError(f"Unsupported piece type: {ptype}") from exc


class AttackPawn(Piece):
    pass


class DefensePawn(Piece):
    pass


class ConquestPawn(Piece):
    pass


class King(Piece):
    pass


@dataclass(frozen=True)
class TerritoryClaim:
    claimant: str
    created_turn: int
    mature_turn: int


@dataclass(frozen=True)
class SpecialControl:
    controlled: Dict[str, Tuple[Vec2, ...]]
    required_majority: int
    claim: Optional[TerritoryClaim]

    @property
    def counts(self) -> Dict[str, int]:
        return {player: len(self.controlled.get(player, ())) for player in PLAYERS}


@dataclass(frozen=True)
class VictoryResult:
    winner: str
    reason: str
    loser: Optional[str] = None


@dataclass(frozen=True)
class DefendedKingPreview:
    attacker_id: PieceId
    king_id: PieceId
    attacker_origin: Vec2
    king_position: Vec2
    attack_direction: Direction
    bounce_direction: Direction
    attack_path: Tuple[Vec2, ...]
    bounce_path: Tuple[Vec2, ...]
    landing_position: Vec2
    eligible_defender_ids: Tuple[PieceId, ...]
    triggers_transform: bool
    action_cost: int
    ends_turn: bool


@dataclass(frozen=True)
class Action:
    kind: str
    player: str
    start: Optional[Vec2] = None
    end: Optional[Vec2] = None
    cost: int = 0
    capture: bool = False
    captured_player: Optional[str] = None
    captured_piece_type: Optional[str] = None
    target_piece_type: Optional[str] = None
    defended_king: Optional[DefendedKingPreview] = None
    selected_defender: Optional[Vec2] = None
    ends_turn: bool = False
    error: Optional[str] = None


@dataclass(frozen=True)
class TransitionEvent:
    kind: str
    data: Dict[str, Any]


@dataclass(frozen=True)
class TransitionResult:
    action: Action
    events: Tuple[TransitionEvent, ...] = ()
    victory: Optional[VictoryResult] = None
    special_control: Optional[SpecialControl] = None
    error: Optional[str] = None
    ends_turn: bool = False
    next_moves_this_turn: int = 0
    next_king_moved: bool = False


@dataclass(frozen=True)
class PlacementStep:
    player: str
    count: int


@dataclass(frozen=True)
class PlacementResult:
    ok: bool
    reason: Optional[str] = None


class Board:
    """Authoritative, Pygame-independent rules engine.

    The class deliberately preserves the legacy app's mutable matrix API while
    making all rule decisions flow through ``build_action`` / ``legal_actions``
    / ``apply_action``.
    """

    PIECE_ORDER: List[str] = [
        "King",
        *["AttackPawn"] * 4,
        *["DefensePawn"] * 4,
        *["ConquestPawn"] * 4,
    ]
    PLACEMENT_SCHEDULE: Tuple[PlacementStep, ...] = (
        PlacementStep("Black", 1),
        PlacementStep("White", 2),
        PlacementStep("Black", 2),
        PlacementStep("White", 2),
        PlacementStep("Black", 2),
        PlacementStep("White", 2),
        PlacementStep("Black", 2),
        PlacementStep("White", 2),
        PlacementStep("Black", 2),
        PlacementStep("White", 2),
        PlacementStep("Black", 2),
        PlacementStep("White", 2),
        PlacementStep("Black", 2),
        PlacementStep("White", 1),
    )

    def __init__(
        self,
        cfg: Optional[GameConfig] = None,
        *,
        seed: Optional[int] = None,
        generate_specials: bool = True,
    ):
        self.cfg = cfg or GameConfig()
        self.grid: List[List[Optional[Piece]]] = [
            [None for _ in range(self.cfg.COLS)] for _ in range(self.cfg.ROWS)
        ]
        self.special_squares: Set[Vec2] = set()
        self.transform_squares: Set[Vec2] = set()
        self.controlled_squares: Dict[str, Set[Vec2]] = {player: set() for player in PLAYERS}
        self.captured_pieces: Dict[str, Dict[str, int]] = {
            player: {ptype: 0 for ptype in PIECE_TYPES} for player in PLAYERS
        }
        self.territory_claim: Optional[TerritoryClaim] = None
        if generate_specials:
            self._generate_special_squares(self.cfg.SPECIAL_COUNT, seed=seed)

    def __getitem__(self, idx: int) -> List[Optional[Piece]]:
        return self.grid[idx]

    def clone(self) -> "Board":
        return copy.deepcopy(self)

    @staticmethod
    def in_bounds(pos: Vec2, cfg: GameConfig) -> bool:
        r, c = pos
        return 0 <= r < cfg.ROWS and 0 <= c < cfg.COLS

    def is_in_bounds(self, pos: Vec2) -> bool:
        return Board.in_bounds(pos, self.cfg)

    @staticmethod
    def rotate_cw(dr: int, dc: int) -> Tuple[int, int]:
        return (-dc, dr)

    @staticmethod
    def rotate_ccw(dr: int, dc: int) -> Tuple[int, int]:
        return (dc, -dr)

    @staticmethod
    def _sign(n: int) -> int:
        return (n > 0) - (n < 0)

    @staticmethod
    def _direction(start: Vec2, end: Vec2) -> Direction:
        return (Board._sign(end[0] - start[0]), Board._sign(end[1] - start[1]))

    @staticmethod
    def _cheb(a: Vec2, b: Vec2) -> int:
        return max(abs(a[0] - b[0]), abs(a[1] - b[1]))

    @staticmethod
    def square_name(pos: Vec2, rows: int = 12) -> str:
        r, c = pos
        return f"{chr(ord('A') + c)}{rows - r}"

    def piece_id_at(self, pos: Vec2) -> PieceId:
        piece = self.grid[pos[0]][pos[1]]
        if piece is None:
            raise RuleError(f"No piece at {pos}")
        return f"{piece.player}:{piece.type}@{self.square_name(pos, self.cfg.ROWS)}"

    def position_for_piece_id(self, piece_id: PieceId) -> Optional[Vec2]:
        if "@" in piece_id:
            token = piece_id.rsplit("@", 1)[1]
            if token and token[0].isalpha() and token[1:].isdigit():
                col = ord(token[0].upper()) - ord("A")
                row = self.cfg.ROWS - int(token[1:])
                pos = (row, col)
                if self.is_in_bounds(pos):
                    return pos
        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                piece = self.grid[r][c]
                if piece and self.piece_id_at((r, c)) == piece_id:
                    return (r, c)
        return None

    def _generate_special_squares(self, count: Optional[int] = None, *, seed: Optional[int] = None) -> None:
        self.special_squares = self.generate_special_squares(
            self.cfg.SPECIAL_COUNT if count is None else count,
            seed=seed,
        )

    def generate_special_squares(self, count: int = 5, *, seed: Optional[int] = None) -> Set[Vec2]:
        if count < 0:
            raise SpecialSquareGenerationError("Special-square count cannot be negative")
        rng = random.Random(seed)
        rows = range(1, self.cfg.ROWS - 1)
        if self.cfg.COLS >= 8:
            cols = range(3, self.cfg.COLS - 3)
        else:
            cols = range(1, self.cfg.COLS - 1)
        candidates = [(r, c) for r in rows for c in cols]
        rng.shuffle(candidates)

        chosen: List[Vec2] = []
        for pos in candidates:
            if all(self._cheb(pos, other) >= 3 for other in chosen):
                chosen.append(pos)
                if len(chosen) == count:
                    return set(chosen)
        raise SpecialSquareGenerationError(
            f"Could not place {count} Special Squares with spacing >= 3 on "
            f"{self.cfg.ROWS}x{self.cfg.COLS}"
        )

    def _generate_transform_square(self, *, seed: Optional[int] = None) -> bool:
        self.transform_squares.clear()
        rng = random.Random(seed)
        pawns: List[Tuple[int, int, str]] = []
        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                piece = self.grid[r][c]
                if piece and piece.type in PAWN_TYPES:
                    pawns.append((r, c, piece.player))

        candidates: List[Vec2] = []
        for r in range(1, self.cfg.ROWS - 1):
            for c in range(1, self.cfg.COLS - 1):
                pos = (r, c)
                if pos in self.special_squares or self.grid[r][c] is not None:
                    continue
                dists = sorted(
                    (self._cheb(pos, (pr, pc)), player) for pr, pc, player in pawns
                )
                if len(dists) < 2:
                    continue
                (d1, p1), (d2, p2) = dists[0], dists[1]
                if d1 == d2 and p1 != p2:
                    candidates.append(pos)
        if not candidates:
            return False
        self.transform_squares.add(rng.choice(sorted(candidates)))
        return True

    def move_transform_square(self, *, seed: Optional[int] = None) -> bool:
        self.transform_squares.clear()
        return self._generate_transform_square(seed=seed)

    @staticmethod
    def is_allowed_capture_type(mover: Piece, target: Piece) -> bool:
        if mover.player == target.player:
            return False
        if mover.type == "AttackPawn":
            return target.type in ("DefensePawn", "King")
        if mover.type == "DefensePawn":
            return target.type == "ConquestPawn"
        if mover.type == "ConquestPawn":
            return target.type == "AttackPawn"
        if mover.type == "King":
            return target.type in PAWN_TYPES
        return False

    def next_piece_type_for(self, player: str, pieces_left: Dict[str, Dict[str, int]]) -> Optional[str]:
        for ptype in Board.PIECE_ORDER:
            if pieces_left[player][ptype] > 0:
                return ptype
        return None

    def validate_placement_schedule(self) -> None:
        totals = {player: 0 for player in PLAYERS}
        for step in self.PLACEMENT_SCHEDULE:
            if step.player not in PLAYERS:
                raise RuleError(f"Unknown placement player {step.player}")
            if step.count <= 0:
                raise RuleError("Placement step must place at least one piece")
            totals[step.player] += step.count
            if totals[step.player] > len(self.PIECE_ORDER):
                raise RuleError(f"Placement schedule overfills {step.player}")
        expected = {player: len(self.PIECE_ORDER) for player in PLAYERS}
        if totals != expected:
            raise RuleError(f"Placement schedule totals {totals}, expected {expected}")

    def square_disallowed_for_placement(self, row: int, col: int, player: str, ptype: str) -> bool:
        return not self.can_place_piece((row, col), player, ptype).ok

    def can_place_piece(self, pos: Vec2, player: str, ptype: str) -> PlacementResult:
        if player not in PLAYERS:
            return PlacementResult(False, "unsupported player")
        if ptype not in PIECE_TYPES:
            return PlacementResult(False, "unsupported piece type")
        if not self.is_in_bounds(pos):
            return PlacementResult(False, "outside board")
        row, col = pos
        if self.grid[row][col] is not None:
            return PlacementResult(False, "occupied square")
        if pos in self.special_squares:
            return PlacementResult(False, "Special Square")
        if pos in self.transform_squares:
            return PlacementResult(False, "Transform Square")
        if ptype == "King":
            if player == "Black" and col >= self.cfg.COLS // 2:
                return PlacementResult(False, "Black King must be in the left half")
            if player == "White" and col < self.cfg.COLS // 2:
                return PlacementResult(False, "White King must be in the right half")
        elif ptype == "AttackPawn":
            if player == "Black" and col >= 2:
                return PlacementResult(False, "Black Attack Pawns must be in the first two columns")
            if player == "White" and col < self.cfg.COLS - 2:
                return PlacementResult(False, "White Attack Pawns must be in the final two columns")
        elif ptype == "ConquestPawn":
            if any(self._cheb(pos, special) < 3 for special in self.special_squares):
                return PlacementResult(False, "Conquest Pawn must be at least three squares from every Special Square")
        return PlacementResult(True)

    def place_piece(self, pos: Vec2, player: str, ptype: str) -> PlacementResult:
        result = self.can_place_piece(pos, player, ptype)
        if not result.ok:
            return result
        self.grid[pos[0]][pos[1]] = Piece.create(ptype, player)
        return result

    def adjacent_defenders_for_king(self, king_pos: Vec2, king_player: str) -> Tuple[Vec2, ...]:
        defenders: List[Vec2] = []
        kr, kc = king_pos
        for dr, dc in ADJACENT_8:
            pos = (kr + dr, kc + dc)
            if not self.is_in_bounds(pos):
                continue
            piece = self.grid[pos[0]][pos[1]]
            if piece and piece.player == king_player and piece.type == "DefensePawn":
                defenders.append(pos)
        return tuple(sorted(defenders))

    def get_defense_adjacent_to_king(self, king_row: int, king_col: int, king_player: str) -> Optional[Vec2]:
        defenders = self.adjacent_defenders_for_king((king_row, king_col), king_player)
        return defenders[0] if defenders else None

    def defense_pawn_guards_king(self, row: int, col: int) -> bool:
        piece = self.grid[row][col]
        if not piece or piece.type != "DefensePawn":
            return False
        for dr, dc in ADJACENT_8:
            pos = (row + dr, col + dc)
            if not self.is_in_bounds(pos):
                continue
            maybe_king = self.grid[pos[0]][pos[1]]
            if maybe_king and maybe_king.player == piece.player and maybe_king.type == "King":
                return True
        return False

    def _intermediate_clear(self, start: Vec2, end: Vec2) -> bool:
        if self._cheb(start, end) != 2:
            return True
        mid = ((start[0] + end[0]) // 2, (start[1] + end[1]) // 2)
        return self.grid[mid[0]][mid[1]] is None

    def _attack_path(self, start: Vec2, end: Vec2) -> Tuple[Vec2, ...]:
        dist = self._cheb(start, end)
        direction = self._direction(start, end)
        return tuple((start[0] + direction[0] * i, start[1] + direction[1] * i) for i in range(1, dist + 1))

    def get_defended_king_preview_from_positions(
        self,
        attacker_origin: Vec2,
        king_position: Vec2,
        *,
        moves_this_turn: int = 0,
    ) -> Optional[DefendedKingPreview]:
        if not (self.is_in_bounds(attacker_origin) and self.is_in_bounds(king_position)):
            return None
        attacker = self.grid[attacker_origin[0]][attacker_origin[1]]
        king = self.grid[king_position[0]][king_position[1]]
        if not attacker or not king:
            return None
        if attacker.type != "AttackPawn" or king.type != "King" or attacker.player == king.player:
            return None

        dist = self._cheb(attacker_origin, king_position)
        direction = self._direction(attacker_origin, king_position)
        if direction not in ORTHOGONAL_4 or dist not in (1, 2):
            return None
        if dist == 2 and moves_this_turn != 0:
            return None
        if dist == 2 and not self._intermediate_clear(attacker_origin, king_position):
            return None

        defenders = self.adjacent_defenders_for_king(king_position, king.player)
        if not defenders:
            return None

        bounce_direction = (-direction[0], -direction[1])
        bounce_path: List[Vec2] = []
        landing: Optional[Vec2] = None
        for step in range(1, 6):
            candidate = (
                king_position[0] + bounce_direction[0] * step,
                king_position[1] + bounce_direction[1] * step,
            )
            if not self.is_in_bounds(candidate):
                break
            occupant = self.grid[candidate[0]][candidate[1]]
            if occupant is not None and candidate != attacker_origin:
                break
            bounce_path.append(candidate)
            landing = candidate

        if landing is None:
            return None
        return DefendedKingPreview(
            attacker_id=self.piece_id_at(attacker_origin),
            king_id=self.piece_id_at(king_position),
            attacker_origin=attacker_origin,
            king_position=king_position,
            attack_direction=direction,
            bounce_direction=bounce_direction,
            attack_path=self._attack_path(attacker_origin, king_position),
            bounce_path=tuple(bounce_path),
            landing_position=landing,
            eligible_defender_ids=tuple(self.piece_id_at(pos) for pos in defenders),
            triggers_transform=landing in self.transform_squares,
            action_cost=dist,
            ends_turn=True,
        )

    def get_defended_king_preview(self, attacker_id: PieceId, king_id: PieceId) -> Optional[DefendedKingPreview]:
        attacker_pos = self.position_for_piece_id(attacker_id)
        king_pos = self.position_for_piece_id(king_id)
        if attacker_pos is None or king_pos is None:
            return None
        return self.get_defended_king_preview_from_positions(attacker_pos, king_pos)

    def repulse_attack_pawn_path(self, start: Vec2, king: Vec2, steps: int = 5) -> List[Vec2]:
        """Legacy animation helper backed by the deterministic engine preview.

        The returned path begins at the attacker's original square because the
        current Pygame animation starts there. The canonical preview's
        ``bounce_path`` still contains the full ray from the King outward.
        """
        preview = self.get_defended_king_preview_from_positions(start, king)
        if preview is None:
            return [start]
        path = [start]
        seen_start = False
        for pos in preview.bounce_path:
            if pos == start:
                seen_start = True
                continue
            if not seen_start:
                continue
            if self._cheb(start, pos) > steps:
                break
            path.append(pos)
        if path[-1] != preview.landing_position:
            path.append(preview.landing_position)
        return path

    def _capture_geometry_ok(self, mover: Piece, start: Vec2, end: Vec2, target: Piece, moves_this_turn: int) -> Tuple[bool, int, str]:
        dr = end[0] - start[0]
        dc = end[1] - start[1]
        adr, adc = abs(dr), abs(dc)
        dist = max(adr, adc)

        if not self.is_allowed_capture_type(mover, target):
            return False, 0, "piece type cannot capture target type"

        if mover.type == "AttackPawn":
            if not ((adr in (1, 2) and adc == 0) or (adc in (1, 2) and adr == 0)):
                return False, 0, "Attack Pawn captures orthogonally only"
            if dist == 2:
                if moves_this_turn != 0:
                    return False, 0, "two-square capture must be the first action"
                if not self._intermediate_clear(start, end):
                    return False, 0, "intermediate square is blocked"
            return True, dist, ""

        if mover.type == "DefensePawn":
            if adr != adc or dist not in (1, 2):
                return False, 0, "Defense Pawn captures diagonally only"
            if dist == 2:
                if moves_this_turn != 0:
                    return False, 0, "two-square capture must be the first action"
                if not self._intermediate_clear(start, end):
                    return False, 0, "intermediate square is blocked"
            return True, dist, ""

        if mover.type == "ConquestPawn":
            if dist != 1:
                return False, 0, "Conquest Pawn captures adjacent Attack Pawns only"
            return True, 1, ""

        if mover.type == "King":
            if dist != 1:
                return False, 0, "King captures adjacent pawns only"
            return True, 1, ""

        return False, 0, "unsupported piece type"

    def build_action(
        self,
        start: Vec2,
        end: Vec2,
        *,
        moves_this_turn: int = 0,
        king_moved: bool = False,
        selected_defender: Optional[Vec2] = None,
    ) -> Action:
        if moves_this_turn >= 2:
            return Action("invalid", "", start=start, end=end, error="no action points remain")
        if not (self.is_in_bounds(start) and self.is_in_bounds(end)):
            return Action("invalid", "", start=start, end=end, error="outside board")

        mover = self.grid[start[0]][start[1]]
        if mover is None:
            return Action("invalid", "", start=start, end=end, error="no piece at start")
        if mover.type == "King" and king_moved:
            return Action("invalid", mover.player, start=start, end=end, error="King has already acted this turn")
        if start == end:
            return Action("invalid", mover.player, start=start, end=end, error="start equals destination")

        target = self.grid[end[0]][end[1]]
        dist = self._cheb(start, end)
        if target is None:
            if dist != 1:
                return Action("invalid", mover.player, start=start, end=end, error="normal movement is one adjacent square")
            return Action(
                "move",
                mover.player,
                start=start,
                end=end,
                cost=1,
                ends_turn=moves_this_turn + 1 >= 2,
            )

        if target.player == mover.player:
            return Action("invalid", mover.player, start=start, end=end, error="destination has a friendly piece")

        ok, cost, reason = self._capture_geometry_ok(mover, start, end, target, moves_this_turn)
        if not ok:
            return Action("invalid", mover.player, start=start, end=end, error=reason)
        if moves_this_turn + cost > 2:
            return Action("invalid", mover.player, start=start, end=end, error="not enough action points")

        preview = None
        captured_type = target.type
        captured_player = target.player
        ends_turn = moves_this_turn + cost >= 2 or target.type == "King"
        if mover.type == "AttackPawn" and target.type == "King":
            preview = self.get_defended_king_preview_from_positions(start, end, moves_this_turn=moves_this_turn)
            if preview is not None:
                captured_type = "DefensePawn"
                captured_player = target.player
                ends_turn = True
                if selected_defender is not None and selected_defender not in self.adjacent_defenders_for_king(end, target.player):
                    return Action("invalid", mover.player, start=start, end=end, error="selected defender is not eligible")

        return Action(
            "capture",
            mover.player,
            start=start,
            end=end,
            cost=cost,
            capture=True,
            captured_player=captured_player,
            captured_piece_type=captured_type,
            target_piece_type=target.type,
            defended_king=preview,
            selected_defender=selected_defender,
            ends_turn=ends_turn,
        )

    def legal_actions(
        self,
        player: str,
        *,
        moves_this_turn: int = 0,
        king_moved: bool = False,
        include_pass: bool = True,
    ) -> List[Action]:
        actions: List[Action] = []
        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                piece = self.grid[r][c]
                if not piece or piece.player != player:
                    continue
                if piece.type == "King" and king_moved:
                    continue
                for dr in (-2, -1, 0, 1, 2):
                    for dc in (-2, -1, 0, 1, 2):
                        if dr == 0 and dc == 0:
                            continue
                        end = (r + dr, c + dc)
                        if not self.is_in_bounds(end):
                            continue
                        action = self.build_action(
                            (r, c),
                            end,
                            moves_this_turn=moves_this_turn,
                            king_moved=king_moved,
                        )
                        if action.error is None:
                            actions.append(action)
        if include_pass:
            actions.append(Action("pass", player, ends_turn=True))
        return actions

    def update_control(self) -> Dict[str, Set[Vec2]]:
        control = {player: set() for player in PLAYERS}
        for pos in self.special_squares:
            piece = self.grid[pos[0]][pos[1]]
            if piece and piece.type == "ConquestPawn":
                control[piece.player].add(pos)
        self.controlled_squares = control
        return control

    def required_special_majority(self) -> int:
        return len(self.special_squares) // 2 + 1

    def get_special_control(self) -> SpecialControl:
        self.update_control()
        return SpecialControl(
            controlled={player: tuple(sorted(self.controlled_squares[player])) for player in PLAYERS},
            required_majority=self.required_special_majority(),
            claim=self.territory_claim,
        )

    def current_majority_player(self) -> Optional[str]:
        self.update_control()
        required = self.required_special_majority()
        winners = [player for player in PLAYERS if len(self.controlled_squares[player]) >= required]
        return winners[0] if len(winners) == 1 else None

    def refresh_territory_claim(self, *, turn_counter: int) -> Optional[VictoryResult]:
        majority = self.current_majority_player()
        if majority is None:
            self.territory_claim = None
            return None
        if self.territory_claim is None or self.territory_claim.claimant != majority:
            self.territory_claim = TerritoryClaim(
                claimant=majority,
                created_turn=turn_counter,
                mature_turn=turn_counter + 2,
            )
            return None
        if turn_counter >= self.territory_claim.mature_turn:
            return VictoryResult(majority, "territory")
        return None

    def evaluate_victory(self, *, last_actor: Optional[str] = None, turn_counter: Optional[int] = None) -> Optional[VictoryResult]:
        kings = {player: False for player in PLAYERS}
        for row in self.grid:
            for piece in row:
                if piece and piece.type == "King":
                    kings[piece.player] = True
        for player, alive in kings.items():
            if not alive:
                winner = "White" if player == "Black" else "Black"
                if last_actor in PLAYERS:
                    winner = last_actor
                return VictoryResult(winner=winner, reason="king_capture", loser=player)
        if turn_counter is not None:
            territory = self.refresh_territory_claim(turn_counter=turn_counter)
            if territory:
                return territory
        return None

    def apply_action(
        self,
        action: Action,
        *,
        moves_this_turn: int = 0,
        king_moved: bool = False,
        validate: bool = True,
    ) -> TransitionResult:
        if action.kind == "pass":
            return TransitionResult(
                action=action,
                events=(TransitionEvent("pass", {"player": action.player}),),
                special_control=self.get_special_control(),
                ends_turn=True,
                next_moves_this_turn=0,
                next_king_moved=False,
            )
        if action.start is None or action.end is None:
            return TransitionResult(action=action, error="action is missing coordinates")

        checked = self.build_action(
            action.start,
            action.end,
            moves_this_turn=moves_this_turn,
            king_moved=king_moved,
            selected_defender=action.selected_defender,
        ) if validate else action
        if checked.error is not None:
            return TransitionResult(action=checked, error=checked.error)

        start = checked.start
        end = checked.end
        assert start is not None and end is not None
        mover = self.grid[start[0]][start[1]]
        target = self.grid[end[0]][end[1]]
        if mover is None:
            return TransitionResult(action=checked, error="no piece at start")

        events: List[TransitionEvent] = []
        victory: Optional[VictoryResult] = None
        landing = end

        if checked.defended_king is not None:
            preview = checked.defended_king
            defenders = self.adjacent_defenders_for_king(end, target.player if target else "")
            defender_pos = checked.selected_defender or defenders[0]
            if defender_pos not in defenders:
                return TransitionResult(action=checked, error="selected defender is not eligible")
            if preview.landing_position is None:
                return TransitionResult(action=checked, error="defended King has no legal bounce landing")
            defender_piece = self.grid[defender_pos[0]][defender_pos[1]]
            if defender_piece is None or defender_piece.type != "DefensePawn":
                return TransitionResult(action=checked, error="defender disappeared before resolution")

            self.grid[start[0]][start[1]] = None
            self.grid[defender_pos[0]][defender_pos[1]] = None
            landing = preview.landing_position
            self.grid[landing[0]][landing[1]] = mover
            self.captured_pieces[defender_piece.player]["DefensePawn"] += 1
            events.extend(
                (
                    TransitionEvent("defended_king", {
                        "king": end,
                        "defender": defender_pos,
                        "landing": landing,
                    }),
                    TransitionEvent("capture", {
                        "captured_player": defender_piece.player,
                        "captured_piece_type": "DefensePawn",
                        "at": defender_pos,
                    }),
                    TransitionEvent("bounce", {
                        "path": preview.bounce_path,
                        "landing": landing,
                    }),
                )
            )
        else:
            self.grid[start[0]][start[1]] = None
            self.grid[end[0]][end[1]] = mover
            if target is not None:
                self.captured_pieces[target.player][target.type] += 1
                events.append(TransitionEvent("capture", {
                    "captured_player": target.player,
                    "captured_piece_type": target.type,
                    "at": end,
                }))
                if target.type == "King":
                    victory = VictoryResult(winner=mover.player, reason="king_capture", loser=target.player)
            else:
                events.append(TransitionEvent("move", {"from": start, "to": end}))

        self.update_control()
        if landing in self.transform_squares and mover.type in PAWN_TYPES:
            events.append(TransitionEvent("transform_available", {
                "player": mover.player,
                "piece_type": mover.type,
                "at": landing,
            }))

        next_moves = moves_this_turn + checked.cost
        next_king_moved = king_moved or mover.type == "King"
        ends_turn = checked.ends_turn or next_moves >= 2
        if ends_turn:
            next_moves = 0
            next_king_moved = False

        if victory is None:
            victory = self.evaluate_victory(last_actor=mover.player)

        return TransitionResult(
            action=checked,
            events=tuple(events),
            victory=victory,
            special_control=self.get_special_control(),
            ends_turn=ends_turn,
            next_moves_this_turn=next_moves,
            next_king_moved=next_king_moved,
        )

    def snapshot(self) -> Dict[str, Any]:
        return self.to_dict()

    def restore(self, snapshot: Dict[str, Any]) -> None:
        restored = Board.from_dict(snapshot)
        self.cfg = restored.cfg
        self.grid = restored.grid
        self.special_squares = restored.special_squares
        self.transform_squares = restored.transform_squares
        self.controlled_squares = restored.controlled_squares
        self.captured_pieces = restored.captured_pieces
        self.territory_claim = restored.territory_claim

    def to_dict(self) -> Dict[str, Any]:
        grid: List[List[Optional[Dict[str, str]]]] = []
        for row in self.grid:
            grid.append([
                None if piece is None else {"player": piece.player, "type": piece.type}
                for piece in row
            ])
        return {
            "config": {
                "rows": self.cfg.ROWS,
                "cols": self.cfg.COLS,
                "special_count": self.cfg.SPECIAL_COUNT,
                "transform_enabled": self.cfg.TRANSFORM_ENABLED,
                "transform_round": self.cfg.TRANSFORM_ROUND,
            },
            "grid": grid,
            "special_squares": sorted(self.special_squares),
            "transform_squares": sorted(self.transform_squares),
            "controlled_squares": {
                player: sorted(squares) for player, squares in self.controlled_squares.items()
            },
            "captured_pieces": copy.deepcopy(self.captured_pieces),
            "territory_claim": None if self.territory_claim is None else {
                "claimant": self.territory_claim.claimant,
                "created_turn": self.territory_claim.created_turn,
                "mature_turn": self.territory_claim.mature_turn,
            },
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Board":
        config = data.get("config", {})
        board = cls(
            GameConfig(
                ROWS=int(config.get("rows", 12)),
                COLS=int(config.get("cols", 12)),
                SPECIAL_COUNT=int(config.get("special_count", 5)),
                TRANSFORM_ENABLED=bool(config.get("transform_enabled", False)),
                TRANSFORM_ROUND=int(config.get("transform_round", 10)),
            ),
            generate_specials=False,
        )
        for r, row in enumerate(data["grid"]):
            for c, cell in enumerate(row):
                if cell:
                    board.grid[r][c] = Piece.create(cell["type"], cell["player"])
        board.special_squares = {tuple(pos) for pos in data.get("special_squares", [])}  # type: ignore[misc]
        board.transform_squares = {tuple(pos) for pos in data.get("transform_squares", [])}  # type: ignore[misc]
        board.controlled_squares = {
            player: {tuple(pos) for pos in data.get("controlled_squares", {}).get(player, [])}  # type: ignore[misc]
            for player in PLAYERS
        }
        board.captured_pieces = {
            player: {
                ptype: int(data.get("captured_pieces", {}).get(player, {}).get(ptype, 0))
                for ptype in PIECE_TYPES
            }
            for player in PLAYERS
        }
        claim = data.get("territory_claim")
        if claim:
            board.territory_claim = TerritoryClaim(
                claimant=claim["claimant"],
                created_turn=int(claim["created_turn"]),
                mature_turn=int(claim["mature_turn"]),
            )
        board.update_control()
        return board

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))

    @classmethod
    def from_json(cls, payload: str) -> "Board":
        return cls.from_dict(json.loads(payload))


class GameHistory:
    def __init__(self) -> None:
        self._snapshots: List[Dict[str, Any]] = []

    def push(self, board: Board) -> None:
        self._snapshots.append(board.snapshot())

    def undo(self, board: Board) -> bool:
        if not self._snapshots:
            return False
        board.restore(self._snapshots.pop())
        return True

    def __len__(self) -> int:
        return len(self._snapshots)


def legal_actions(state: Board, player: Optional[str] = None, *, moves_this_turn: int = 0, king_moved: bool = False) -> List[Action]:
    actor = player or "Black"
    return state.legal_actions(actor, moves_this_turn=moves_this_turn, king_moved=king_moved)


def apply_action(state: Board, action: Action, *, moves_this_turn: int = 0, king_moved: bool = False) -> TransitionResult:
    return state.apply_action(action, moves_this_turn=moves_this_turn, king_moved=king_moved)


def evaluate_victory(state: Board) -> Optional[VictoryResult]:
    return state.evaluate_victory()


def get_special_control(state: Board) -> SpecialControl:
    return state.get_special_control()


def get_defended_king_preview(state: Board, attacker_id: PieceId, king_id: PieceId) -> Optional[DefendedKingPreview]:
    return state.get_defended_king_preview(attacker_id, king_id)


def validate_placement_schedule(schedule: Sequence[PlacementStep] = Board.PLACEMENT_SCHEDULE) -> Dict[str, int]:
    totals = {player: 0 for player in PLAYERS}
    for step in schedule:
        if step.count <= 0:
            raise RuleError("Placement step must be positive")
        if totals[step.player] + step.count > len(Board.PIECE_ORDER):
            raise RuleError(f"Placement step overfills {step.player}")
        totals[step.player] += step.count
    expected = {player: len(Board.PIECE_ORDER) for player in PLAYERS}
    if totals != expected:
        raise RuleError(f"Placement totals {totals}, expected {expected}")
    return totals
