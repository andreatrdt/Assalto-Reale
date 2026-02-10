from __future__ import annotations
import pygame

######################################################################
#                          Top‑level imports                         #
######################################################################
import copy
import os
import random
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple
import sys
Vec2 = Tuple[int, int]  # (row, col)


######################################################################
#                          Configuration                             #
######################################################################

@dataclass(frozen=True)
class GameConfig:
    """Window geometry, board size and styling constants."""

    # Window / board geometry ------------------------------------------------
    WIDTH: int = 1000
    HEIGHT: int = 812
    ROWS: int = 12
    COLS: int = 12

    SPECIAL_COUNT: int = 5

    # UI layout (computed on‑class so they are available as GameConfig.X) ----
    RIGHT_MARGIN: int = 240  # reserved for HUD
    SQ_SIZE: int = WIDTH // (COLS + 4)

    # Colours ---------------------------------------------------------------
    WHITE: Tuple[int, int, int] = (255, 255, 255)
    BLACK: Tuple[int, int, int] = (0, 0, 0)
    LIGHT_BROWN: Tuple[int, int, int] = (222, 184, 135)
    DARK_BROWN: Tuple[int, int, int] = (139, 69, 19)
    GREEN: Tuple[int, int, int] = (61, 77, 48)
    HIGHLIGHT: Tuple[int, int, int] =(136, 136, 136)
    RED_HIGHLIGHT: Tuple[int, int, int] = (255, 0, 0)
    GRAY: Tuple[int, int, int] = (99, 102, 106)
    BUTTON_COLOR: Tuple[int, int, int] = (125, 125, 125)

    # Flash effect settings --------------------------------------------------
    FLASH_DURATION: float = 2.0
    BLINK_INTERVAL: float = 1.0

    # Assets
    ASSETS_DIR: str = field(default_factory=lambda: os.path.join(os.path.dirname(__file__), "assets"))


######################################################################
#                              Assets                                #
######################################################################

class AssetLoader:
    """Loads and scales all PNG sprites + the move SFX once at start‑up."""

    def __init__(self, cfg: GameConfig):
        pygame.init()
        pygame.mixer.init()
        self.cfg = cfg

        # --- piece sprites --------------------------------------------------
        self.piece_images: Dict[str, Dict[str, pygame.Surface]] = {}
        self._load_piece_images()

        # --- audio ----------------------------------------------------------
        self.move_sound = self._load_sound("move_chess.wav")
        self.capture_sound = self._load_sound("attack_chess.wav")
        self.shield_sound = self._load_sound("shield_chess.ogg")
        self.victory_sound = self._load_sound("Victory.wav")
        
        raw = pygame.image.load(os.path.join(self.cfg.ASSETS_DIR, "transform_square.png"))
        # scala a mezzo SQ_SIZE se vuoi un’icona piccola, o a SQ_SIZE per una dimensione piena
        size = cfg.SQ_SIZE // 2
        self.transform_icon = pygame.transform.scale(raw, (size, size))
        self.placement_history: list[dict] = []


    # ------------------------------------------------------------------ #
    def _load_sound(self, filename: str) -> pygame.mixer.Sound:
        return pygame.mixer.Sound(os.path.join(self.cfg.ASSETS_DIR, filename))

    def _load_piece_images(self) -> None:
        piece_defs = {
            "Black": ["attack_pawn", "defense_pawn", "conquest_pawn", "king"],
            "White": ["attack_pawn", "defense_pawn", "conquest_pawn", "king"],
        }
        for colour, names in piece_defs.items():
            self.piece_images[colour] = {}
            for name in names:
                raw = pygame.image.load(os.path.join(self.cfg.ASSETS_DIR, f"{colour.lower()}_{name}.png"))
                raw = pygame.transform.scale(raw, (2 * self.cfg.SQ_SIZE // 3, 2 * self.cfg.SQ_SIZE // 3))
                key = {
                    "attack_pawn": "AttackPawn",
                    "defense_pawn": "DefensePawn",
                    "conquest_pawn": "ConquestPawn",
                    "king": "King",
                }[name]
                self.piece_images[colour][key] = raw


######################################################################
#                               Pieces                               #
######################################################################

@dataclass
class Piece:
    player: str  # "Black" | "White"
    type: str    # "AttackPawn" | "DefensePawn" | "ConquestPawn" | "King"

    def valid_move(self, board: "Board", start: Vec2, end: Vec2, moves_this_turn: int) -> bool:
        """Dispatch to concrete subclasses."""
        return False

    @staticmethod
    def create(ptype: str, player: str) -> "Piece":
        cls_map = {
            "AttackPawn": AttackPawn,
            "DefensePawn": DefensePawn,
            "ConquestPawn": ConquestPawn,
            "King": King,
        }
        return cls_map[ptype](player, ptype)  # type: ignore[misc]


class AttackPawn(Piece):
    def valid_move(self, board: "Board", start: Vec2, end: Vec2, moves_this_turn: int) -> bool:  # noqa: N802
        rs, cs = start
        re, ce = end
        dr, dc = abs(re - rs), abs(ce - cs)
        target = board[re][ce]

        # capture -----------------------------------------------------------
        if target and target.player != self.player:
            if (dr, dc) in [(1, 0), (0, 1)]:
                return Board.is_allowed_capture_type(self, target)
            if (dr, dc) in [(2, 0), (0, 2)] and moves_this_turn == 0:
                mid_r, mid_c = (rs + re) // 2, (cs + ce) // 2
                if target.type != "King" and board[mid_r][mid_c] is not None:
                    return False
                if target.type == "King" and board[mid_r][mid_c] is not None:
                    mid_piece = board[mid_r][mid_c]
                    if not (
                        mid_piece.type == "DefensePawn"
                        and mid_piece.player == target.player
                        and board.defense_pawn_guards_king(mid_r, mid_c)
                    ):
                        return False
                return Board.is_allowed_capture_type(self, target)
            return False
        # normal move -------------------------------------------------------
        return (not target) and max(dr, dc) == 1


class DefensePawn(Piece):
    def valid_move(self, board: "Board", start: Vec2, end: Vec2, moves_this_turn: int) -> bool:  # noqa: N802
        rs, cs = start
        re, ce = end
        dr, dc = abs(re - rs), abs(ce - cs)
        target = board[re][ce]
        if target and target.player != self.player:
            if (dr, dc) == (1, 1):
                return Board.is_allowed_capture_type(self, target)
            if (dr, dc) == (2, 2) and moves_this_turn == 0:
                mid_r, mid_c = (rs + re) // 2, (cs + ce) // 2
                if board[mid_r][mid_c] is not None:
                    return False
                return Board.is_allowed_capture_type(self, target)
            return False
        return (not target) and max(dr, dc) == 1


class ConquestPawn(Piece):
    def valid_move(self, board: "Board", start: Vec2, end: Vec2, moves_this_turn: int) -> bool:  # noqa: N802
        rs, cs = start
        re, ce = end
        dr, dc = abs(re - rs), abs(ce - cs)
        target = board[re][ce]
        if target and target.player != self.player:
            if max(dr, dc) == 1:
                return Board.is_allowed_capture_type(self, target)
            return False
        return (not target) and max(dr, dc) == 1


class King(Piece):
    def valid_move(self, board: "Board", start: Vec2, end: Vec2, moves_this_turn: int) -> bool:  # noqa: N802
        rs, cs = start
        re, ce = end
        dr, dc = abs(re - rs), abs(ce - cs)
        target = board[re][ce]
        if target:
            return False
        return max(dr, dc) == 1 and target is None


######################################################################
#                                Board                               #
######################################################################

class Board:
    """Board matrix of pieces plus helper methods for rules."""

    PIECE_ORDER: List[str] = [
        "King",
        *["AttackPawn"] * 4,
        *["DefensePawn"] * 4,
        *["ConquestPawn"] * 4,
    ]

    # ------------------------------------------------------------------ #
    def __init__(self, cfg: GameConfig):
        self.cfg = cfg
        self.grid: List[List[Optional[Piece]]] = [[None for _ in range(cfg.COLS)] for _ in range(cfg.ROWS)]

        # special squares ---------------------------------------------------
        self.special_squares: Set[Vec2] = set()
        self._generate_special_squares()
        # casella di trasformazione (1 sola)
        self.transform_squares: Set[Vec2] = set()
        # self._generate_transform_square()

        # bookkeeping -------------------------------------------------------
        self.controlled_squares: Dict[str, Set[Vec2]] = {"Black": set(), "White": set()}
        self.captured_pieces: Dict[str, Dict[str, int]] = {
            "Black": {t: 0 for t in ["AttackPawn", "DefensePawn", "ConquestPawn", "King"]},
            "White": {t: 0 for t in ["AttackPawn", "DefensePawn", "ConquestPawn", "King"]},
        }

    # ------------------------------------------------------------------ #
    def __getitem__(self, idx):
        return self.grid[idx]

    # ------------------------------------------------------------------ #
    # in class Board:
    def _generate_special_squares(self, count: int = 5) -> None:
        self.special_squares.clear()
        attempts = 0
        while len(self.special_squares) < count and attempts < 100_000:
            r = random.randint(1, self.cfg.ROWS - 2)
            c = random.randint(3, self.cfg.COLS - 4)
            if all(max(abs(r - rr), abs(c - cc)) >= 3 for rr, cc in self.special_squares):
                self.special_squares.add((r, c))
            attempts += 1



    def _generate_transform_square(self) -> bool:
        """Generate a transform square following the equality rule.

        The chosen square must not be occupied or special and must be
        equidistant from the two closest pawns belonging to different
        players.  If no such square exists the set remains empty and
        ``False`` is returned.
        """

        self.transform_squares.clear()

        pawns: list[tuple[int, int, str]] = []
        for rr in range(self.cfg.ROWS):
            for cc in range(self.cfg.COLS):
                p = self.grid[rr][cc]
                if p and p.type != "King":
                    pawns.append((rr, cc, p.player))

        candidates: list[Vec2] = []
        for r in range(1, self.cfg.ROWS - 1):
            for c in range(1, self.cfg.COLS - 1):
                if (r, c) in self.special_squares:
                    continue
                if self.grid[r][c] is not None:
                    continue
                dists = sorted(
                    (
                        (max(abs(r - pr), abs(c - pc)), player)
                        for pr, pc, player in pawns
                    ),
                    key=lambda x: x[0],
                )
                if len(dists) < 2:
                    continue
                (d1, p1), (d2, p2) = dists[0], dists[1]
                if d1 == d2 and p1 != p2:
                    candidates.append((r, c))

        if candidates:
            self.transform_squares.add(random.choice(candidates))
            return True

        return False

    
    def move_transform_square(self) -> None:
        """Move the transform square to a new valid location."""
        self.transform_squares.clear()
        self._generate_transform_square()
    # ------------------------------------------------------------------ #
    @staticmethod
    def is_allowed_capture_type(mover: Piece, target: Piece) -> bool:
        if mover.type == "AttackPawn":
            return target.type in ("King", "DefensePawn")
        if mover.type == "DefensePawn":
            return target.type == "ConquestPawn"
        if mover.type == "ConquestPawn":
            return target.type == "AttackPawn"
        if mover.type == "King":
            return target.type in ("AttackPawn", "DefensePawn", "ConquestPawn")
        return False

    # ========================= placement helpers ===================== #
    def next_piece_type_for(self, player: str, pieces_left: Dict[str, Dict[str, int]]) -> Optional[str]:
        for p in Board.PIECE_ORDER:
            if pieces_left[player][p] > 0:
                return p
        return None

    def square_disallowed_for_placement(self, row: int, col: int, player: str, ptype: str) -> bool:
        if (row, col) in self.special_squares:
            return True
        if (row, col) in self.transform_squares:
            return True
        if ptype == "ConquestPawn":
            return any(max(abs(row - r), abs(col - c)) < 3 for r, c in self.special_squares)
        if ptype == "AttackPawn":
            return (col >= 2 if player == "Black" else col < self.cfg.COLS - 2)
        if ptype == "King":
            return (col >= self.cfg.COLS // 2 if player == "Black" else col < self.cfg.COLS // 2)
        return False
    
    

    # ============================ drawing ============================ #

    # ================================================================= #
    #                    Extra helper utilities (static)                #
    # ================================================================= #

    @staticmethod
    def in_bounds(pos: Vec2, cfg: GameConfig) -> bool:
        r, c = pos
        return 0 <= r < cfg.ROWS and 0 <= c < cfg.COLS

    @staticmethod
    def rotate_cw(dr: int, dc: int) -> Tuple[int, int]:
        return (-dc, dr)

    @staticmethod
    def rotate_ccw(dr: int, dc: int) -> Tuple[int, int]:
        return (dc, -dr)
    
    def get_defense_adjacent_to_king(
        self,
        king_row: int,
        king_col: int,
        king_player: str
        ) -> Optional[Vec2]:
            for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1),
                        (-1, -1), (-1, 1), (1, -1), (1, 1)]:
                rr, cc = king_row + dr, king_col + dc
                if 0 <= rr < self.cfg.ROWS and 0 <= cc < self.cfg.COLS:
                    p = self.grid[rr][cc]
                    if p and p.type == "DefensePawn" and p.player == king_player:
                        return rr, cc
            return None

    def defense_pawn_guards_king(self, row: int, col: int) -> bool:
        pawn = self.grid[row][col]
        if not pawn or pawn.type != "DefensePawn":
            return False
        for dr, dc in [
            (-1, 0), (1, 0), (0, -1), (0, 1),
            (-1, -1), (-1, 1), (1, -1), (1, 1)
        ]:
            rr, cc = row + dr, col + dc
            if 0 <= rr < self.cfg.ROWS and 0 <= cc < self.cfg.COLS:
                k = self.grid[rr][cc]
                if k and k.type == "King" and k.player == pawn.player:
                    return True
        return False


    # ------------------------------------------------------------------ #
    def repulse_attack_pawn_path(self, start: Vec2, king: Vec2, steps: int = 5) -> List[Vec2]:
        """Return path taken when an AttackPawn is repulsed by a defended king."""
        path = [start]
        cr, cc = start
        kr, kc = king

        # unit vector from king to pawn
        dr = (cr - kr) // max(1, abs(cr - kr)) if cr != kr else 0
        dc = (cc - kc) // max(1, abs(cc - kc)) if cc != kc else 0

        for _ in range(steps):
            nr, nc = cr + dr, cc + dc
            if not Board.in_bounds((nr, nc), self.cfg):
                # try to rotate direction if we are about to leave board
                candidates = []
                for rot in (Board.rotate_cw, Board.rotate_ccw):
                    r_dr, r_dc = rot(dr, dc)
                    if Board.in_bounds((cr + r_dr, cc + r_dc), self.cfg):
                        candidates.append((r_dr, r_dc))
                if not candidates:
                    break
                dr, dc = random.choice(candidates)
                nr, nc = cr + dr, cc + dc

            if self.grid[nr][nc] is None:
                cr, cc = nr, nc
                path.append((cr, cc))
                continue

            # jump over contiguous block
            jump_len = 0
            tr, tc = nr, nc
            while Board.in_bounds((tr, tc), self.cfg) and self.grid[tr][tc] is not None:
                jump_len += 1
                tr += dr
                tc += dc
            land_r, land_c = cr + (jump_len + 1) * dr, cc + (jump_len + 1) * dc
            if not Board.in_bounds((land_r, land_c), self.cfg) or self.grid[land_r][land_c] is not None:
                break
            cr, cc = land_r, land_c
            path.append((cr, cc))

        return path
