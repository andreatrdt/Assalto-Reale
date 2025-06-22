from __future__ import annotations


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

import pygame

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
            if (dr, dc) in [(2, 1), (1, 2)] and moves_this_turn == 0:
                return Board.is_allowed_capture_type(self, target)
            return False
        return (not target) and max(dr, dc) == 1


class King(Piece):
    def valid_move(self, board: "Board", start: Vec2, end: Vec2, moves_this_turn: int) -> bool:  # noqa: N802
        rs, cs = start
        re, ce = end
        dr, dc = abs(re - rs), abs(ce - cs)
        target = board[re][ce]
        if target and target.player != self.player:
            return max(dr, dc) == 1  # capture any adjacent piece
        return (not target) and max(dr, dc) == 1


######################################################################
#                                Board                               #
######################################################################

class Board:
    """12×12 matrix of pieces plus helper methods for rules & rendering."""

    PIECE_ORDER: List[str] = [
        "King",
        *["AttackPawn"] * 4,
        *["DefensePawn"] * 4,
        *["ConquestPawn"] * 4,
    ]

    # ------------------------------------------------------------------ #
    def __init__(self, cfg: GameConfig, assets: AssetLoader):
        self.cfg = cfg
        self.assets = assets
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



    def _generate_transform_square(self) -> None:
        while not self.transform_squares:
            r = random.randint(1, self.cfg.ROWS - 2)
            c = random.randint(3, self.cfg.COLS - 4)
            if (r, c) not in self.special_squares:
                self.transform_squares.add((r, c))

    
    def move_transform_square(self) -> None:
        """Rimuove l’attuale casella di trasformazione e ne genera subito una nuova."""
        # svuota il set (eravamo in genere in singleton)
        self.transform_squares.clear()
        # genera una nuova posizione casuale che non sovrapponga special_squares
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
    def draw(
        self,
        surface: pygame.Surface,
        font: pygame.font.Font,
        selected: Optional[Vec2] = None,
        valid_moves: Optional[List[Vec2]] = None,
    ) -> None:
        cfg = self.cfg
        surface.fill(cfg.GRAY)

        # --- squares ---------------------------------------------------
        for r in range(cfg.ROWS):
            for c in range(cfg.COLS):
                base = cfg.LIGHT_BROWN if (r + c) % 2 == 0 else cfg.DARK_BROWN
                pygame.draw.rect(surface, base, (c * cfg.SQ_SIZE, r * cfg.SQ_SIZE, cfg.SQ_SIZE, cfg.SQ_SIZE))

        # --- special squares ------------------------------------------
        for r, c in self.special_squares:
            pygame.draw.circle(
                surface,
                cfg.GREEN,
                (c * cfg.SQ_SIZE + cfg.SQ_SIZE // 2, r * cfg.SQ_SIZE + cfg.SQ_SIZE // 2),
                cfg.SQ_SIZE // 3 + 5,
            )
        # --- transform squares (icona) ---
        for r, c in self.transform_squares:
            icon = self.assets.transform_icon
            # calcolo del centro del quadrato
            x = c * cfg.SQ_SIZE + cfg.SQ_SIZE // 2
            y = r * cfg.SQ_SIZE + cfg.SQ_SIZE // 2
            rect = icon.get_rect(center=(x, y))
            surface.blit(icon, rect)
        # --- pieces ----------------------------------------------------
        for r in range(cfg.ROWS):
            for c in range(cfg.COLS):
                piece = self.grid[r][c]
                if piece:
                    img = self.assets.piece_images[piece.player][piece.type]
                    rect = img.get_rect(center=(c * cfg.SQ_SIZE + cfg.SQ_SIZE // 2, r * cfg.SQ_SIZE + cfg.SQ_SIZE // 2))
                    surface.blit(img, rect)

        # --- highlights ------------------------------------------------
        if selected and valid_moves:
            for r, c in valid_moves:
                target = self.grid[r][c]
                colour = cfg.RED_HIGHLIGHT if target else cfg.HIGHLIGHT
                pygame.draw.circle(
                    surface,
                    colour,
                    (c * cfg.SQ_SIZE + cfg.SQ_SIZE // 2, r * cfg.SQ_SIZE + cfg.SQ_SIZE // 2),
                    cfg.SQ_SIZE // 6,
                )
    


        # --- board coordinates ----------------------------------------
        margin = 10
        num_x = cfg.COLS * cfg.SQ_SIZE + margin
        for r in range(cfg.ROWS):
            lbl = font.render(str(cfg.ROWS - r), True, cfg.BLACK)
            y   = r * cfg.SQ_SIZE + (cfg.SQ_SIZE // 2) - (lbl.get_height() // 2)
            surface.blit(lbl, (num_x, y))

        # files (letters) just below the grid
        file_y = cfg.ROWS * cfg.SQ_SIZE + margin
        for c in range(cfg.COLS):
            lbl = font.render(chr(ord("A") + c), True, cfg.BLACK)
            x   = c * cfg.SQ_SIZE + (cfg.SQ_SIZE // 2) - (lbl.get_width() // 2)
            surface.blit(lbl, (x, file_y))

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



class AssaltoRealeGame:
    players = ["Black", "White"]

    # ------------------------------------------------------------------ #
    def __init__(self):
        self.cfg = GameConfig()
        self.assets = AssetLoader(self.cfg)

        # ─── menu settings before game ───────────────────────────────
        self.timer_options   = [5*60, 10*60, 12*60, 15*60, 20*60]
        self.timer_index     = 2                  # default 12′
        self.board_sizes     = [(8,8), (10,10), (12,12), (14,14), (16,16), (18,18)]
        self.board_index     = 2                  # default 12×12
        # allow selecting how many special squares to generate
        self.special_options = [3, 4, 5, 6, 7]
        # default to 5 (the old behavior)
        self.special_index   = self.special_options.index(5)
        self.settings      = {}


        # pygame init …
        pygame.init()
        self.screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
        self.SCR_W, self.SCR_H = self.screen.get_size()
        pygame.display.set_caption("Assalto Reale – OOP edition")
        self.clock = pygame.time.Clock()
        self.font  = pygame.font.SysFont("bookmanoldstyle", 20)

        # placeholder; we'll overwrite after menu
        self.time_left   = {"Black": 0.0, "White": 0.0}
        self._last_tick  = 0
        self.time_font   = pygame.font.SysFont("bookmanoldstyle", 26, bold=True)

        # pygame --------------------------------------------------------
        pygame.init()
        self.screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
        self.SCR_W, self.SCR_H = self.screen.get_size()

        bg_path = os.path.join(self.cfg.ASSETS_DIR, "background_MENU.png")
        self.menu_background = pygame.image.load(bg_path).convert()
        self.menu_background = pygame.transform.scale(
            self.menu_background,
            (self.SCR_W, self.SCR_H)
        )
        self.SCR_W, self.SCR_H = self.screen.get_size()
        pygame.display.set_caption("Assalto Reale – OOP edition")
        self.clock = pygame.time.Clock()
        self.font = pygame.font.SysFont("bookmanoldstyle", 20)

        self.time_left   = {"Black": 12 * 60.0,   # seconds
                            "White": 12 * 60.0}
        self._last_tick  = pygame.time.get_ticks()   # ms timestamp
        self.time_font   = pygame.font.SysFont("bookmanoldstyle", 26, bold=True)

        # core state ----------------------------------------------------
        self.placement_history: list[dict] = []  
        self.board = Board(self.cfg, self.assets)
        self._flash_effects: dict[Vec2, int] = {}
        self.current_player: int = 0  # index into players
        self.moves_this_turn: int = 0
        self.selected: Optional[Vec2] = None
        self.running: bool = True
        self.candidate_winner: Optional[str] = None
        self.candidate_turn_index: int | None = None
        self.both_at_four: bool = False
        self.turn_counter: int = 0          # increments every time we switch
        self.last_move: Optional[Tuple[Vec2, Vec2]] = None
        self.menu_active   = False
        self.menu_winner   = None  # "Black" or "White"
        # button rects, computed after you know OX/OY/SQ:
        self.menu_buttons  = {}    # will hold {'save':Rect, 'quit':Rect}



        # placement‑phase bookkeeping ----------------------------------
        self.placing: bool = True
        self.pieces_left: Dict[str, Dict[str, int]] = {
            "Black": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
            "White": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
        }
        self.pieces_placed: Dict[str, int] = {"Black": 0, "White": 0}
        self.turn_sequence: List[int] = [1] + [2] * 12 + [1]
        self.turn_index: int = 0
        self.turn_pieces_count: int = 0

        # undo / redo ---------------------------------------------------
        self.move_history: List[dict] = []

        # UI geometry ---------------------------------------------------
        self._init_ui_geometry()

    # ============================= UI layout ========================= #
    def _init_ui_geometry(self) -> None:
        # ─── Compute left edge of HUD area ─────────────────────────────
        board_width = self.cfg.COLS * self.cfg.SQ_SIZE
        padding = 300
        self.UI_X = board_width + padding

        # Base vertical start
        current_y = 50

        # ─── Scoreboard ────────────────────────────────────────────────
        self.SCOREBOARD_W, self.SCOREBOARD_H = 125, 75
        self.SCOREBOARD_X = self.UI_X
        self.SCOREBOARD_Y = current_y

        # ─── Placement icon ────────────────────────────────────────────
        self.PLACEMENT_ICON_W, self.PLACEMENT_ICON_H = 125, 63
        self.PLACEMENT_ICON_X = self.UI_X - 170
        self.PLACEMENT_ICON_Y = current_y
        current_y += self.SCOREBOARD_H + 20

        # current_y += self.PLACEMENT_ICON_H + 20

        # ─── Timer panel ──────────────────────────────────────────────
        self.TIMER_W, self.TIMER_H = 125, 75
        self.TIMER_X = self.UI_X + self.TIMER_W//2
        self.TIMER_Y = current_y
        current_y += self.TIMER_H + 20


        # ─── Undo button ───────────────────────────────────────────────
        self.UNDO_W, self.UNDO_H = 60, 50
        self.UNDO_X = self.UI_X
        self.UNDO_Y = current_y
        current_y += self.UNDO_H + 20
        
        # ─── PASS / TURN button ────────────────────────────────────────
        self.BUTTON_W, self.BUTTON_H = 125, 50
        self.BUTTON_X = self.UI_X
        self.BUTTON_Y = current_y
        current_y += self.BUTTON_H + 20

        # ─── Reset button ──────────────────────────────────────────────
        self.RESET_W, self.RESET_H = 125, 50
        self.RESET_X = self.UI_X
        self.RESET_Y = current_y
        current_y += self.RESET_H + 20

        # ─── Quit button ───────────────────────────────────────────────
        self.QUIT_W, self.QUIT_H = 125, 50
        self.QUIT_X = self.UI_X
        self.QUIT_Y = current_y
        current_y += self.QUIT_H + 20

        # ─── Save button ───────────────────────────────────────────────
        self.SAVE_W, self.SAVE_H = 125, 50
        self.SAVE_X = self.UI_X
        self.SAVE_Y = current_y
        current_y += self.SAVE_H + 20

        # ─── Load button ───────────────────────────────────────────────
        self.LOAD_W, self.LOAD_H = 125, 50
        self.LOAD_X = self.UI_X
        self.LOAD_Y = current_y
        current_y += self.LOAD_H + 20


        # ─── Capture-counter panel ─────────────────────────────────────
        self.CAPTURE_COUNTER_W, self.CAPTURE_COUNTER_H = 250, 128
        self.CAPTURE_COUNTER_X = self.UI_X
        self.CAPTURE_COUNTER_Y = current_y

    def reset_game(self):
        # 1) remember the menu picks
        saved_timer       = self.settings.get("timer")
        saved_board_size  = self.settings.get("board_size")
        saved_special_idx = self.special_index

        # 2) re-init core state
        self.__init__()      # re-runs __init__, but overwrote our saved picks…

        # 3) restore our saved picks
        self.settings["timer"]      = saved_timer
        self.settings["board_size"] = saved_board_size
        self.special_index          = saved_special_idx

        # 4) re-apply exactly the same settings _without_ showing menu again
        t = saved_timer
        rows, cols = saved_board_size
        self.cfg = GameConfig(ROWS=rows, COLS=cols)
        object.__setattr__(self.cfg, 'SQ_SIZE', self.cfg.WIDTH // (cols + 4))
        self.assets = AssetLoader(self.cfg)
        self._init_ui_geometry()

        # 5) rebuild board with exactly the same # special squares
        self.board = Board(self.cfg, self.assets)
        self.board._generate_special_squares(self.special_options[self.special_index])

        # 6) reset clocks & other per-game state
        self.time_left  = {"Black": t, "White": t}
        self._last_tick = pygame.time.get_ticks()
        self.placing     = True
        self.pieces_left = {
            "Black": {"AttackPawn":4,"DefensePawn":4,"ConquestPawn":4,"King":1},
            "White": {"AttackPawn":4,"DefensePawn":4,"ConquestPawn":4,"King":1},
        }
        self.placement_history.clear()
        self.move_history.clear()
        self.current_player   = 0
        self.moves_this_turn  = 0
        self.turn_counter     = 0
        self.menu_active      = False


    def _show_start_menu(self) -> None:
        title_f = pygame.font.SysFont("bookmanoldstyle", 48, bold=True)
        sub_f   = pygame.font.SysFont("bookmanoldstyle", 30)

        # --- load creators image once
        creator_orig = pygame.image.load(os.path.join(self.cfg.ASSETS_DIR, "CREATORS.jpeg")).convert_alpha()
        creator_img  = pygame.transform.smoothscale(creator_orig, (120, 120))
        creator_pos  = (130, self.SCR_H - 20 - creator_img.get_height())
        caption_surf = sub_f.render("The creators of  Assalto Reale:", True, (255,255,255))
        caption_pos  = (20, creator_pos[1] - creator_img.get_height()//2)

        # Buttons
        btn_w, btn_h = 250, 60
        start_btn = pygame.Rect((self.SCR_W - btn_w) // 2, self.SCR_H - 170, btn_w, btn_h)
        load_btn  = pygame.Rect((self.SCR_W - btn_w) // 2, self.SCR_H - 100, btn_w, btn_h)

        labels = ["Timer (min)", "Board size", "Special Squares"]
        get_values = [
            lambda: str(self.timer_options[self.timer_index] // 60),
            lambda: f"{self.board_sizes[self.board_index][0]}×{self.board_sizes[self.board_index][1]}",
            lambda: str(self.special_options[self.special_index]),
        ]

        x_center   = self.SCR_W // 2
        top_margin = 200
        n          = len(labels)
        total_h    = (self.SCR_H - top_margin) - 300
        spacing_y  = total_h // (n + 1)

        arrow_size = 40
        gap        = 100
        quit_rect  = pygame.Rect(self.SCR_W - 40, 10, 30, 30)

        error_message = None  # 🛑

        while True:
            for ev in pygame.event.get():
                if ev.type == pygame.QUIT:
                    pygame.quit(); sys.exit()
                if ev.type == pygame.MOUSEBUTTONDOWN:
                    mx, my = ev.pos
                    if quit_rect.collidepoint(mx, my):
                        pygame.quit(); sys.exit()

                    # arrow clicks
                    for i in range(n):
                        y_label = top_margin + i * spacing_y
                        y_val   = y_label + 40
                        left  = pygame.Rect(x_center - gap - arrow_size, y_val - arrow_size//2, arrow_size, arrow_size)
                        right = pygame.Rect(x_center + gap,              y_val - arrow_size//2, arrow_size, arrow_size)

                        if left.collidepoint(mx, my):
                            if i == 0:
                                self.timer_index   = (self.timer_index   - 1) % len(self.timer_options)
                            elif i == 1:
                                self.board_index   = (self.board_index   - 1) % len(self.board_sizes)
                            else:
                                self.special_index = (self.special_index - 1) % len(self.special_options)

                        if right.collidepoint(mx, my):
                            if i == 0:
                                self.timer_index   = (self.timer_index   + 1) % len(self.timer_options)
                            elif i == 1:
                                self.board_index   = (self.board_index   + 1) % len(self.board_sizes)
                            else:
                                self.special_index = (self.special_index + 1) % len(self.special_options)

                    # START NEW GAME
                    if start_btn.collidepoint(mx, my):
                        self.settings["timer"]         = self.timer_options[self.timer_index]
                        self.settings["board_size"]    = self.board_sizes[self.board_index]
                        self.settings["special_count"] = self.special_options[self.special_index]
                        return

                    # LOAD SAVED GAME
                    if load_btn.collidepoint(mx, my):
                        try:
                            self._load_moves_from_file("moves.txt")
                            self.settings["timer"] = float(self.time_left["Black"])
                            self.settings["board_size"] = (self.cfg.ROWS, self.cfg.COLS)
                            self.settings["special_count"] = len(self.board.special_squares)
                            return
                        except Exception as e:
                            error_message = str(e)

            # --- draw everything
            self.screen.blit(self.menu_background, (0, 0))
            # Quit-X
            pygame.draw.rect(self.screen, (200,50,50), quit_rect)
            pygame.draw.line(self.screen, (255,255,255), quit_rect.topleft, quit_rect.bottomright, 3)
            pygame.draw.line(self.screen, (255,255,255), quit_rect.topright, quit_rect.bottomleft, 3)

            # Title
            t_surf = title_f.render("Assalto Reale", True, (240,240,240))
            self.screen.blit(t_surf, t_surf.get_rect(center=(x_center, 100)))

            # selectors
            for i, label in enumerate(labels):
                y_label = top_margin + i * spacing_y
                lbl = sub_f.render(label, True, (200,200,200))
                self.screen.blit(lbl, lbl.get_rect(center=(x_center, y_label)))
                y_val = y_label + 40
                val = sub_f.render(get_values[i](), True, (255,255,255))
                self.screen.blit(val, val.get_rect(center=(x_center, y_val)))
                left  = pygame.Rect(x_center - gap - arrow_size, y_val - arrow_size//2, arrow_size, arrow_size)
                right = pygame.Rect(x_center + gap,              y_val - arrow_size//2, arrow_size, arrow_size)
                pygame.draw.polygon(self.screen, (180,180,180),
                    [(left.right,left.top),(left.left,left.centery),(left.right,left.bottom)])
                pygame.draw.polygon(self.screen, (180,180,180),
                    [(right.left,right.top),(right.right,right.centery),(right.left,right.bottom)])

            # START NEW GAME button
            pygame.draw.rect(self.screen, (70,200,70), start_btn)
            st = sub_f.render("START", True, (0,0,0))
            self.screen.blit(st, st.get_rect(center=start_btn.center))

            # LOAD SAVED GAME button
            pygame.draw.rect(self.screen, (70,150,230), load_btn)
            ld = sub_f.render("LOAD GAME", True, (0,0,0))
            self.screen.blit(ld, ld.get_rect(center=load_btn.center))

            # creators image
            self.screen.blit(creator_img, creator_pos)
            self.screen.blit(caption_surf, caption_pos)

            # 🛑 Error overlay
            if error_message:
                self._draw_error_overlay(error_message)

            pygame.display.flip()
            self.clock.tick(30)

    def _draw_error_overlay(self, message: str) -> None:
        overlay = pygame.Surface((self.SCR_W, self.SCR_H), pygame.SRCALPHA)
        overlay.fill((0, 0, 0, 180))
        self.screen.blit(overlay, (0, 0))

        font_big = pygame.font.SysFont("bookmanoldstyle", 36, bold=True)
        font_small = pygame.font.SysFont("bookmanoldstyle", 24)

        error_title = font_big.render("Error Loading Game", True, (255,50,50))
        error_msg   = font_small.render(message, True, (255,255,255))

        self.screen.blit(error_title, error_title.get_rect(center=(self.SCR_W//2, self.SCR_H//2 - 30)))
        self.screen.blit(error_msg, error_msg.get_rect(center=(self.SCR_W//2, self.SCR_H//2 + 20)))


    # =============================== main loop ======================= #
    def run(self) -> None:
        # 1) Show menu to pick timer & board size
        self._show_start_menu()

        # 2) Apply settings
        t = self.settings["timer"]
        rows, cols = self.settings["board_size"]
        special = self.settings.get("special_count", 5)
        # rebuild config with chosen board size
        self.cfg = GameConfig(ROWS=rows, COLS=cols, SPECIAL_COUNT=special)
        # recompute square size:
        object.__setattr__(self.cfg, 'SQ_SIZE', self.cfg.WIDTH // (cols + 4))
        # reload assets, ui geometry, and board
        self.assets = AssetLoader(self.cfg)
        self._init_ui_geometry()
        self.board  = Board(self.cfg, self.assets)
        self.board._generate_special_squares(special)

        # 3) Set the clocks
        self.time_left  = {"Black": t, "White": t}
        self._last_tick = pygame.time.get_ticks()

        # 4) Enter main loop
        while self.running:
            self._update_clock()
            for ev in pygame.event.get():
                if ev.type == pygame.QUIT:
                    self.running = False
                elif ev.type == pygame.MOUSEBUTTONDOWN:
                    self._on_click(ev.pos)
            self._draw()
            self.clock.tick(30)
        pygame.quit()


    def _show_endgame_menu(self, winner: str) -> None:
        self.menu_active = True
        self.menu_winner = winner
        # freeze the board — don’t call pygame.quit() yet
        # build button rects in screen coords:
        cx, cy = self.SCR_W//2, self.SCR_H//2
        w, h   = 200, 50
        spacing = 20
        self.menu_buttons['Save'] = pygame.Rect(cx - w//2, cy,          w, h)
        self.menu_buttons['Quit'] = pygame.Rect(cx - w//2, cy + h + spacing , w, h)
        self.menu_buttons['Restart'] = pygame.Rect(cx - w//2, cy + 2 * (h + spacing), w, h)

    
    def _format_game_history(self) -> str:
        lines: list[str] = []

        # 0) SETTINGS
        lines.append("# SETTINGS")
        lines.append(f"black_time={int(self.time_left['Black'])}")
        lines.append(f"white_time={int(self.time_left['White'])}")
        lines.append(f"current_turn={self.players[self.current_player]}")
        lines.append(f"turn_counter={self.turn_counter}")
        lines.append(f"board_size={self.cfg.ROWS}x{self.cfg.COLS}")
        lines.append("")  # blank

        # 1) SPECIAL_SQUARES
        lines.append("# SPECIAL_SQUARES")
        for (r, c) in sorted(self.board.special_squares):
            sq = f"{chr(ord('A')+c)}{self.cfg.ROWS-r}"
            lines.append(sq)
        lines.append("")  # blank

        # 2) TRANSFORM_SQUARE
        lines.append("# TRANSFORM_SQUARE")
        for (r, c) in sorted(self.board.transform_squares):
            sq = f"{chr(ord('A')+c)}{self.cfg.ROWS-r}"
            lines.append(sq)
        lines.append("")  # blank

        # 3) PLACEMENTS
        lines.append("# PLACEMENTS")
        for i, p in enumerate(self.placement_history, start=1):
            row, col = p["pos"]
            sq = f"{chr(ord('A')+col)}{self.cfg.ROWS-row}"
            lines.append(f"{i}. {p['player']} places {p['type']} on {sq}")
        lines.append("")  # blank

        # 4) MOVES
        lines.append("# MOVES")
        for i, m in enumerate(self.move_history, start=1):
            piece     = m["piece"]
            fr, to    = m["from"], m["to"]
            start_sq  = f"{chr(ord('A')+fr[1])}{self.cfg.ROWS-fr[0]}"
            end_sq    = f"{chr(ord('A')+to[1])}{self.cfg.ROWS-to[0]}"
            captured  = m["captured"]
            if isinstance(captured, dict) and "defense" in captured:
                cap_desc = " (repelled defense pawn)"
            elif captured:
                cap_desc = f" captured {captured.type}"
            else:
                cap_desc = ""
            lines.append(f"{i}. {piece.player} {piece.type} {start_sq}→{end_sq}{cap_desc}")

        return "\n".join(lines)

    
    def _save_moves_to_file(self, filename: str = "moves.txt") -> None:
        log = self._format_game_history()
        with open(filename, "w", encoding="utf-8") as f:
            f.write(log)

    def _parse_game_file(self, filename: str):
        settings: dict[str,str] = {}
        special_sqs: list[Vec2] = []
        transform_sqs: list[Vec2] = []
        placements:   list[dict] = []
        moves:        list[dict] = []
        section:      str | None = None

        with open(filename, "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line:
                    continue
                up = line.upper()
                if up.startswith("# SETTINGS"):
                    section = "settings"; continue
                if up.startswith("# SPECIAL_SQUARES"):
                    section = "special"; continue
                if up.startswith("# TRANSFORM_SQUARE"):
                    section = "transform"; continue
                if up.startswith("# PLACEMENTS"):
                    section = "placements"; continue
                if up.startswith("# MOVES"):
                    section = "moves"; continue
                if line.startswith("#"):
                    continue

                if section == "settings":
                    if "=" in line:
                        key, val = line.split("=",1)
                        settings[key.strip()] = val.strip()

                elif section == "special":
                    for token in line.split():
                        c = ord(token[0].upper()) - ord("A")
                        r = self.cfg.ROWS - int(token[1:])
                        special_sqs.append((r, c))

                elif section == "transform":
                    for token in line.split():
                        c = ord(token[0].upper()) - ord("A")
                        r = self.cfg.ROWS - int(token[1:])
                        transform_sqs.append((r, c))

                elif section == "placements":
                    content = line
                    if ". " in line and line.split(" ",1)[0][:-1].isdigit():
                        _, content = line.split(" ", 1)
                    parts = content.split()
                    # parts = [player, "places", ptype, "on", sq]
                    player, _, ptype, _, sq = parts
                    c = ord(sq[0].upper()) - ord("A")
                    r = self.cfg.ROWS - int(sq[1:])
                    placements.append({"player": player, "type": ptype, "pos": (r, c)})

                elif section == "moves":
                    content = line
                    if ". " in line and line.split(" ",1)[0][:-1].isdigit():
                        _, content = line.split(" ", 1)
                    mv = self._parse_single_move(content)
                    moves.append(mv)
                elif section=="settings":
                    if "=" in line:
                        key,val = line.split("=",1)
                        settings[key.strip()] = val.strip()

        for colour in ("Black","White"):
            for ptype in ("AttackPawn","DefensePawn","ConquestPawn","King"):
                key = f"{colour.lower()}_captured_{ptype}"
                if key in settings:
                    self.board.captured_pieces[colour][ptype] = int(settings[key])

        return settings, special_sqs, transform_sqs, placements, moves




    def _update_clock(self) -> None:
        """Subtract real‑time delta from the *current* player’s clock."""
        now   = pygame.time.get_ticks()
        delta = (now - self._last_tick) / 1000.0   # to seconds
        self._last_tick = now
        player = AssaltoRealeGame.players[self.current_player]
        self.time_left[player] = max(0.0, self.time_left[player] - delta)

        # flag victory if someone runs out
        if self.time_left["Black"] == 0.0:
            self._show_endgame_menu("White")
        elif self.time_left["White"] == 0.0:
            self._show_endgame_menu("Black")

    def _handle_endgame_click(self, pos: Tuple[int,int]) -> None:
        x, y = pos
        if self.menu_buttons['Save'].collidepoint(x,y):
            self._save_moves_to_file()
        elif self.menu_buttons['Quit'].collidepoint(x,y):
            pygame.quit()
            sys.exit()
        elif self.menu_buttons['Restart'].collidepoint(x,y):
            self.reset_game()
            self.menu_active = False
    


    # ============================ event handling ===================== #
    def _on_click(self, pos: Tuple[int, int]) -> None:
        x, y = pos
        if self.menu_active:
            self._handle_endgame_click(pos)
            return

        # --- buttons ---------------------------------------------------
        if self._within(x, y, self.UNDO_X, self.UNDO_Y, self.UNDO_W, self.UNDO_H):
            self._undo()
            return
        if not self.placing and self._within(x, y, self.BUTTON_X, self.BUTTON_Y, self.BUTTON_W, self.BUTTON_H):
            self._end_turn()
            return
        if self._within(x, y, self.RESET_X, self.RESET_Y, self.RESET_W, self.RESET_H):
            self.reset_game()
            return
        if self._within(x, y, self.QUIT_X, self.QUIT_Y, self.QUIT_W, self.QUIT_H):
            self.running = False
            return
            # in _on_click, after your other button‐checks:
        if self._within(x, y, self.SAVE_X, self.SAVE_Y, self.SAVE_W, self.SAVE_H):
            self._save_moves_to_file("moves.txt")
            return
        if self._within(x, y, self.LOAD_X, self.LOAD_Y, self.LOAD_W, self.LOAD_H):
            self._load_moves_from_file("moves.txt")
            return
    


        # --- board interaction ----------------------------------------
        col, row = x // self.cfg.SQ_SIZE, y // self.cfg.SQ_SIZE
        if not (0 <= row < self.cfg.ROWS and 0 <= col < self.cfg.COLS):
            return

        if self.placing:
            self._handle_placement_click((row, col))
        else:
            self._handle_move_click((row, col))

    def _load_moves_from_file(self, filename: str = "moves.txt") -> None:
        # 1) parse everything
        settings, special_sqs, transform_sqs, placements, moves = self._parse_game_file(filename)
        self.moves_this_turn = 0

        # 2) restore the turn counter before anything else
        self.turn_counter = int(settings.get("turn_counter", 0))

        # 3) apply board‐size from settings
        bs = settings.get("board_size", f"{self.cfg.ROWS}x{self.cfg.COLS}")
        rows, cols = [int(x) for x in bs.split("x")]
        self.cfg = GameConfig(ROWS=rows, COLS=cols, SPECIAL_COUNT=self.cfg.SPECIAL_COUNT)
        object.__setattr__(self.cfg, 'SQ_SIZE', self.cfg.WIDTH // (cols + 4))
        self.assets = AssetLoader(self.cfg)
        self._init_ui_geometry()
        self.board = Board(self.cfg, self.assets)

        # 4) override special/transform squares
        self.board.special_squares   = set(special_sqs)
        self.board.transform_squares = set(transform_sqs)

        # 5) exit placement phase
        self.placement_history.clear()
        self.move_history.clear()
        self.placing = False

        # 6) restore clocks & current player
        self.time_left["Black"] = float(settings.get("black_time", 0))
        self.time_left["White"] = float(settings.get("white_time", 0))
        self.current_player      = self.players.index(settings.get("current_turn", "Black"))

        # 7) replay placements
        for p in placements:
            r, c = p["pos"]
            piece = Piece.create(p["type"], p["player"])
            self.board.grid[r][c] = piece
            self.placement_history.append(p)

        # rebuild control for any conquest pawns
        for sq in self.board.special_squares:
            pr = self.board.grid[sq[0]][sq[1]]
            if pr and pr.type == "ConquestPawn":
                self.board.controlled_squares[pr.player].add(sq)

        # 8) replay moves
        for m in moves:
            fr, to = m["start"], m["end"]
            piece = Piece.create(m["type"], m["player"])
            self.board.grid[fr[0]][fr[1]] = None
            self.board.grid[to[0]][to[1]] = piece
            if piece.type == "ConquestPawn":
                if fr in self.board.special_squares:
                    self.board.controlled_squares[piece.player].discard(fr)
                if to in self.board.special_squares:
                    self.board.controlled_squares[piece.player].add(to)
            # record for undo
            self.move_history.append({
                "from": fr, "to": to,
                "piece": copy.deepcopy(piece),
                "captured": None,
                "state": {
                   "current_player": self.current_player,
                   "moves":            self.moves_this_turn
                },
                "special_control": {
                    "Black": self.board.controlled_squares["Black"].copy(),
                    "White": self.board.controlled_squares["White"].copy()
                },
                "control": {
                    "Black": self.board.controlled_squares["Black"].copy(),
                    "White": self.board.controlled_squares["White"].copy()
                },
            })


    def _parse_single_move(self, content: str) -> dict:
        tokens = content.split()
        player, ptype = tokens[0], tokens[1]
        fr_sq, to_sq = tokens[2].split("→")
        col_from = ord(fr_sq[0]) - ord("A")
        row_from = self.cfg.ROWS - int(fr_sq[1:])
        col_to   = ord(to_sq[0]) - ord("A")
        row_to   = self.cfg.ROWS - int(to_sq[1:])
        return {
            "player": player,
            "type":   ptype,
            "start":  (row_from, col_from),
            "end":    (row_to,   col_to),
            "captured": None,
        }


    @staticmethod
    def _within(px: int, py: int, x: int, y: int, w: int, h: int) -> bool:
        return x <= px <= x + w and y <= py <= y + h

    # =========================== placement phase ===================== #
    def _handle_placement_click(self, pos: Vec2) -> None:
        r, c = pos
        if self.board[r][c] is not None:
            return
        player = AssaltoRealeGame.players[self.current_player]
        ptype = self.board.next_piece_type_for(player, self.pieces_left)
        if ptype is None:
            return
        if self.board.square_disallowed_for_placement(r, c, player, ptype):
            return

        # place piece ---------------------------------------------------
        self.board[r][c] = Piece.create(ptype, player)
        self.placement_history.append({
            "player": player,
            "type": ptype,
            "pos":   (r, c),
        })
        self.pieces_left[player][ptype] -= 1
        self.pieces_placed[player] += 1
        self.turn_pieces_count += 1

        if self.turn_pieces_count >= self.turn_sequence[self.turn_index]:
            self._switch_player()
        if sum(self.pieces_placed.values()) == 26:
            self.placing = False

    # =========================== move phase ========================== #
    def _handle_move_click(self, pos: Vec2) -> None:
        r, c = pos
        if self.selected:
            self._attempt_move(self.selected, pos)
        else:
            piece = self.board[r][c]
            if piece and piece.player == AssaltoRealeGame.players[self.current_player]:
                self.selected = pos

    def _attempt_move(self, start: Vec2, end: Vec2) -> None:
        piece = self.board[start[0]][start[1]]
        self.last_move = (start, end)
        if not piece:
            self.selected = None
            return
        if not piece.valid_move(self.board, start, end, self.moves_this_turn):
            self.selected = None
            return

        captured = copy.deepcopy(self.board[end[0]][end[1]])

        if captured:
            self.board.captured_pieces[captured.player][captured.type] += 1

        if (
            piece.type == "AttackPawn"
            and captured
            and captured.type == "King"
        ):
            kr, kc = end
            defender = self.board.get_defense_adjacent_to_king(kr, kc, captured.player)
            if defender:
                self._animate_king_attack(end)
                self.assets.shield_sound.play()

                def_piece = copy.deepcopy(self.board[defender[0]][defender[1]])

                # ── qui aggiorniamo il contatore ──
                self.board.captured_pieces[def_piece.player]["DefensePawn"] += 1

                path   = self.board.repulse_attack_pawn_path(start, end)
                newpos = self._animate_repulsion(path, piece)
                self.board[defender[0]][defender[1]] = None

                self._record_move(
                    start, newpos, piece,
                    {"defense": (def_piece, defender)}
                )


                delta = max(abs(newpos[0] - start[0]), abs(newpos[1] - start[1]))
                self.moves_this_turn += 1 if delta == 1 else 2
                if self.moves_this_turn >= 2:
                    self._switch_player()

                return
                     # <‑‑‑‑‑‑‑‑ STOP here, do **not** fall through
            else:
                # ---- sacrifice branch (King dies) ----
                self._animate_king_attack(end)
                self.assets.capture_sound.play() 
                self._show_endgame_menu(piece.player)
                return

               # game ends inside flash helper


        self._record_move(start, end, piece, captured)

        if (
            captured
            and captured.type == "ConquestPawn"
            and end in self.board.special_squares
        ):
            self.board.controlled_squares[captured.player].discard(end)

        self.board[end[0]][end[1]] = None
        self.board[start[0]][start[1]] = None

        # animazione slide
        self._animate_slide(start, end, piece)

        # piazza il pezzo nella nuova casella
        self.board[end[0]][end[1]] = piece
        # ------------------------------------------------------------
        #   SPECIAL‑SQUARE CONTROL for Conquest‑pawn
        # ------------------------------------------------------------
        if piece.type == "ConquestPawn":
            # if it *left* a special square, drop control
            if start in self.board.special_squares:
                self.board.controlled_squares[piece.player].discard(start)

            # if it *arrived* on a special square, gain control
            if end in self.board.special_squares:
                self.board.controlled_squares[piece.player].add(end)
                self._flash_effects[end] = pygame.time.get_ticks()
                self._check_special_squares()       # update candidate logic

        if captured:                            # any enemy piece was on the square
            self.assets.capture_sound.play()    # • play “attack”
        else:
            self.assets.move_sound.play()       # • otherwise normal move click

        delta = max(abs(end[0] - start[0]), abs(end[1] - start[1]))
        move_cost = 1 if (captured is None or delta == 1) else 2
        self.moves_this_turn += move_cost
        if self.moves_this_turn >= 2:
            self._switch_player()
        self.selected = None

        # se siamo su una casella di trasformazione
        if end in self.board.transform_squares and piece.type in ("AttackPawn","DefensePawn","ConquestPawn"):
            self._prompt_transformation(end, piece)

    # ============================= bookkeeping ======================= #
    def _switch_player(self) -> None:
        self.current_player = 1 - self.current_player
        self.turn_index = min(self.turn_index + 1,
                              len(self.turn_sequence) - 1)
        self.turn_pieces_count = 0
        self.moves_this_turn = 0

        self._last_tick = pygame.time.get_ticks()

        # --- turn counter / pending‑win logic -----------------------
        self.turn_counter += 1
        if self.turn_counter == 30:
            self.board._generate_transform_square()
        self._check_candidate_win()


    def _end_turn(self) -> None:
        self._switch_player()

    # ---------------------- move history (undo) ---------------------- #
    def _record_move(self, start: Vec2, end: Vec2, piece: Piece, captured: Optional[Piece]) -> None:
        self.move_history.append({
            "from": start,
            "to": end,
            "piece": copy.deepcopy(piece),
            "captured": captured,
            "state": {
                "current_player": self.current_player,
                "moves": self.moves_this_turn
            },
            "special_control": {
                "Black": self.board.controlled_squares["Black"].copy(),
                "White": self.board.controlled_squares["White"].copy()
            },
            "control": {
                "Black": self.board.controlled_squares["Black"].copy(),
                "White": self.board.controlled_squares["White"].copy()
            }


        })

    def _undo(self) -> None:          # <-- or  undo_move()  in main.py
        if not self.move_history:     # (history is called  move_history )
            return

        last = self.move_history.pop()
        fr_r, fr_c = last["from"]
        to_r, to_c = last["to"]

        mover      = last["piece"]          # the Attack‑Pawn
        captured   = last["captured"]       # None | Piece | {"defense": (…)}

        # 1) put the moving piece back
        self.board[fr_r][fr_c] = mover

        # 2) restore what was on the landing square
        if isinstance(captured, dict) and "defense" in captured:
            # This was a repulsion: bring the Defence‑Pawn back
            def_piece, def_pos = captured["defense"]
            dp_r, dp_c = def_pos
            self.board[dp_r][dp_c] = def_piece
            self.board[to_r][to_c] = None         # landing square is empty again
        else:
            # normal move / capture / sacrifice
            self.board[to_r][to_c] = captured

        self.board.controlled_squares["Black"] = last["special_control"]["Black"].copy()
        self.board.controlled_squares["White"] = last["special_control"]["White"].copy()

        # 3) rewind turn bookkeeping
        self.current_player = last["state"]["current_player"]
        self.moves_this_turn = last["state"]["moves"]
        self.selected = None

        if "control" in last:
            self.board.controlled_squares["Black"] = last["control"]["Black"].copy()
            self.board.controlled_squares["White"] = last["control"]["White"].copy()



    # ============================== draw ============================= #
    def _draw(self) -> None:
        valid = []
        if self.selected:
            piece = self.board[self.selected[0]][self.selected[1]]
            if piece:
                valid = self._compute_valid_moves(piece, self.selected)

        self.board.draw(self.screen, self.font, self.selected, valid)

        # 🟨 Draw highlight *after* the board is painted
        if self.last_move:
            fr, to = self.last_move
            for r, c in [fr, to]:
                pygame.draw.rect(
                    self.screen,
                    self.cfg.GRAY,
                    (c * self.cfg.SQ_SIZE, r * self.cfg.SQ_SIZE, self.cfg.SQ_SIZE, self.cfg.SQ_SIZE),
                    3
                )

        self._draw_placement_overlay()
        self._draw_hud()
        self._draw_square_flashes()
        if self.menu_active:
            self._draw_endgame_menu()

        pygame.display.flip()

    def _draw_endgame_menu(self) -> None:
        overlay = pygame.Surface((self.SCR_W, self.SCR_H), pygame.SRCALPHA)
        overlay.fill((0, 0, 0, 180))
        self.screen.blit(overlay, (0, 0))

        winner_txt = f"{self.menu_winner} wins"
        surf = self.font.render(winner_txt, True, self.cfg.WHITE)
        self.screen.blit(surf, surf.get_rect(center=(self.SCR_W // 2, self.SCR_H // 2 - 80)))

        for name, rect in self.menu_buttons.items():
            pygame.draw.rect(self.screen, self.cfg.BUTTON_COLOR, rect)
            pygame.draw.rect(self.screen, self.cfg.BLACK, rect, 2)
            txt_surf = self.font.render(name, True, self.cfg.WHITE)
            self.screen.blit(txt_surf, txt_surf.get_rect(center=rect.center))


    
    def _prompt_transformation(self, pos: Vec2, piece: Piece) -> None:
        options = ["AttackPawn", "DefensePawn", "ConquestPawn"]
        icons: list[tuple[pygame.Surface, tuple[int,int]]] = []
        rects: list[pygame.Rect] = []
        size = self.cfg.SQ_SIZE
        spacing = 20
        total_w = len(options)*size + (len(options)-1)*spacing
        start_x = (self.cfg.WIDTH - total_w) // 2
        y = (self.cfg.HEIGHT - size) // 2

        # Prepara icone e rettangoli cliccabili
        for i, opt in enumerate(options):
            img = self.assets.piece_images[piece.player][opt]
            img = pygame.transform.scale(img, (size, size))
            x = start_x + i*(size+spacing)
            icons.append((img, (x, y)))
            rects.append(pygame.Rect(x, y, size, size))

        # Scegli il colore del pannello: bianco se seleziona Nero, nero se seleziona Bianco
        panel_color = self.cfg.WHITE if piece.player == "Black" else self.cfg.BLACK
        # Dimensioni del pannello con un padding
        pad = 10
        panel_x = start_x - pad
        panel_y = y - pad
        panel_w = total_w + 2*pad
        panel_h = size + 2*pad

        selecting = True
        while selecting:
            for ev in pygame.event.get():
                if ev.type == pygame.QUIT:
                    pygame.quit(); sys.exit()
                if ev.type == pygame.MOUSEBUTTONDOWN:
                    mx, my = ev.pos
                    for idx, rect in enumerate(rects):
                        if rect.collidepoint(mx, my):
                            # cambia tipo e riposiziona la transform square
                            new_type = options[idx]
                            player   = piece.player
                            self.board.grid[pos[0]][pos[1]] = Piece.create(new_type, player)
                            self.board.move_transform_square()
                            selecting = False
                            break

            # redraw board
            self.board.draw(self.screen, self.font, None, [])

            # disegna il pannello dietro le icone
            pygame.draw.rect(
                self.screen,
                panel_color,
                (panel_x, panel_y, panel_w, panel_h),
                border_radius=8
            )
            # opzionale: bordo a contrasto
            pygame.draw.rect(
                self.screen,
                (255,255,255) if panel_color==(0,0,0) else (0,0,0),
                (panel_x, panel_y, panel_w, panel_h),
                width=2,
                border_radius=8
            )

            # disegna le icone sopra
            for img, (x, y) in icons:
                self.screen.blit(img, (x, y))

            pygame.display.flip()
            self.clock.tick(30)



    # ------------------------------------------------------------------ #
    def _draw_hud(self) -> None:
        cfg = self.cfg

        # ─── NEW: timer read‑outs ───────────────────────────────────────────
        def fmt(t: float) -> str:
            return f"{int(t)//60:02d}:{int(t)%60:02d}"

        black_t = fmt(self.time_left["Black"])
        white_t = fmt(self.time_left["White"])

        bx = self.TIMER_X
        by = self.TIMER_Y
        wx = self.TIMER_X
        wy = self.TIMER_Y + 40

        # background rectangles for readability
        for (tx, ty, colour, txt) in [
            (bx, by, cfg.BLACK, black_t),
            (wx, wy, cfg.WHITE, white_t),
        ]:
            surf = self.time_font.render(txt, True, colour)
            rect = surf.get_rect(center=(tx, ty))
            pygame.draw.rect(self.screen, cfg.GRAY, rect.inflate(8, 4))
            self.screen.blit(surf, rect)

        pygame.draw.rect(self.screen, cfg.BUTTON_COLOR,
                        (self.LOAD_X, self.LOAD_Y, self.LOAD_W, self.LOAD_H))
        pygame.draw.rect(self.screen, cfg.BLACK,
                        (self.LOAD_X, self.LOAD_Y, self.LOAD_W, self.LOAD_H), 2)
        lbl = self.font.render("LOAD", True, cfg.WHITE)
        lx = self.LOAD_X + (self.LOAD_W - lbl.get_width()) // 2
        ly = self.LOAD_Y + (self.LOAD_H - lbl.get_height()) // 2

        self.screen.blit(lbl, (lx, ly))
        # --- PASS / TURN button ---------------------------------------
        pygame.draw.rect(self.screen, cfg.BUTTON_COLOR, (self.BUTTON_X, self.BUTTON_Y, self.BUTTON_W, self.BUTTON_H))
        pygame.draw.rect(self.screen, cfg.BLACK, (self.BUTTON_X, self.BUTTON_Y, self.BUTTON_W, self.BUTTON_H), 2)
        self.screen.blit(self.font.render("PASS", True, cfg.WHITE), (self.BUTTON_X + 25, self.BUTTON_Y + 13))

        # --- undo -----------------------------------------------------
        pygame.draw.rect(self.screen, cfg.GRAY, (self.UNDO_X, self.UNDO_Y, self.UNDO_W, self.UNDO_H))
        pygame.draw.rect(self.screen, cfg.BLACK, (self.UNDO_X, self.UNDO_Y, self.UNDO_W, self.UNDO_H), 2)
        pygame.draw.polygon(
            self.screen,
            cfg.BLACK,
            [
                (self.UNDO_X + 13, self.UNDO_Y + self.UNDO_H // 2),
                (self.UNDO_X + 38, self.UNDO_Y + 13),
                (self.UNDO_X + 38, self.UNDO_Y + self.UNDO_H - 13),
            ],
        )

        # --- scoreboard ----------------------------------------------
        pygame.draw.rect(self.screen, cfg.BLACK, (self.SCOREBOARD_X, self.SCOREBOARD_Y, self.BUTTON_W, 75), 2)
        pygame.draw.rect(self.screen, cfg.WHITE, (self.SCOREBOARD_X, self.SCOREBOARD_Y, self.BUTTON_W, 38))
        pygame.draw.rect(self.screen, cfg.BLACK, (self.SCOREBOARD_X, self.SCOREBOARD_Y, self.BUTTON_W, 38))

        black_cnt = len(self.board.controlled_squares["Black"])
        white_cnt = len(self.board.controlled_squares["White"])
        self.screen.blit(self.font.render(f"Black: {black_cnt}", True, cfg.WHITE), (self.SCOREBOARD_X + 13, self.SCOREBOARD_Y + 7))
        self.screen.blit(self.font.render(f"White: {white_cnt}", True, cfg.BLACK), (self.SCOREBOARD_X + 13, self.SCOREBOARD_Y + 38))

        # current player circle ---------------------------------------
        turn_colour = cfg.BLACK if self.current_player == 0 else cfg.WHITE
        pygame.draw.circle(self.screen, turn_colour, (self.SCOREBOARD_X - 40, self.SCOREBOARD_Y + 38), 25)

        # --- reset / quit --------------------------------------------
        for x, y, label in [
            (self.RESET_X, self.RESET_Y, "RESET"),
            (self.QUIT_X, self.QUIT_Y, "QUIT"),
        ]:
            pygame.draw.rect(self.screen, cfg.BUTTON_COLOR, (x, y, self.RESET_W, self.RESET_H))
            pygame.draw.rect(self.screen, cfg.BLACK, (x, y, self.RESET_W, self.RESET_H), 2)
            text_rect = self.font.render(label, True, cfg.WHITE)
            self.screen.blit(text_rect, (x + (self.RESET_W - text_rect.get_width()) // 2, y + 13))

        # --- placement icon ------------------------------------------
        if self.placing:
            next_ptype = self.board.next_piece_type_for(AssaltoRealeGame.players[self.current_player], self.pieces_left)
            if next_ptype:
                icon = self.assets.piece_images[AssaltoRealeGame.players[self.current_player]][next_ptype]
                icon = pygame.transform.scale(icon, (self.PLACEMENT_ICON_W  //3, self.PLACEMENT_ICON_H*2//3))
                ix = self.PLACEMENT_ICON_X + (self.PLACEMENT_ICON_W - icon.get_width() + 10) // 2
                iy = self.PLACEMENT_ICON_Y + (self.PLACEMENT_ICON_H - icon.get_height()) // 2
                self.screen.blit(icon, (ix, iy))

        # --- capture counter (very compact) ---------------------------
        if any(v for d in self.board.captured_pieces.values() for v in d.values()):
            self._draw_capture_counter()


        pygame.draw.rect(self.screen, cfg.BUTTON_COLOR,
                        (self.SAVE_X, self.SAVE_Y, self.SAVE_W, self.SAVE_H))
        pygame.draw.rect(self.screen, cfg.BLACK,
                        (self.SAVE_X, self.SAVE_Y, self.SAVE_W, self.SAVE_H), 2)
        save_lbl = self.font.render("SAVE", True, cfg.WHITE)
        lx = self.SAVE_X + (self.SAVE_W - save_lbl.get_width()) // 2
        ly = self.SAVE_Y + (self.SAVE_H - save_lbl.get_height()) // 2
        self.screen.blit(save_lbl, (lx, ly))

        # LOAD:
        pygame.draw.rect(self.screen, cfg.BUTTON_COLOR,
                        (self.LOAD_X, self.LOAD_Y, self.LOAD_W, self.LOAD_H))
        pygame.draw.rect(self.screen, cfg.BLACK,
                        (self.LOAD_X, self.LOAD_Y, self.LOAD_W, self.LOAD_H), 2)
        load_lbl = self.font.render("LOAD", True, cfg.WHITE)
        lx = self.LOAD_X + (self.LOAD_W - load_lbl.get_width()) // 2
        ly = self.LOAD_Y + (self.LOAD_H - load_lbl.get_height()) // 2
        self.screen.blit(load_lbl, (lx, ly))

                # --- captured pieces on board margins in HUD ----------------
        icon_size = self.cfg.SQ_SIZE // 2
        spacing   = 4
        board_w_px = self.cfg.COLS * self.cfg.SQ_SIZE
        board_h_px = self.cfg.ROWS * self.cfg.SQ_SIZE




    def _draw_capture_counter(self) -> None:
        cfg = self.cfg
        piece_order = ["King", "AttackPawn", "DefensePawn", "ConquestPawn"]
        counter_w, counter_h = 250, 256
        x, y = self.CAPTURE_COUNTER_X, self.CAPTURE_COUNTER_Y
        row_h = (counter_h // 2) // 4
        icon_sz = 25
        spacing = 7

        pygame.draw.rect(self.screen, cfg.GRAY, (x, y, counter_w, counter_h))
        mid_y = y + counter_h // 2

        # top  – Black pieces captured by White -----------------------
        for i, ptype in enumerate(piece_order):
            cx = x + 7
            cnt = self.board.captured_pieces["Black"][ptype]
            for _ in range(cnt):
                icon = pygame.transform.scale(self.assets.piece_images["Black"][ptype], (icon_sz, icon_sz))
                self.screen.blit(icon, (cx, y + 7 + i * row_h))
                cx += icon_sz + spacing

        # bottom – White pieces captured by Black ---------------------
        for i, ptype in enumerate(piece_order):
            cx = x + 7
            cnt = self.board.captured_pieces["White"][ptype]
            for _ in range(cnt):
                icon = pygame.transform.scale(self.assets.piece_images["White"][ptype], (icon_sz, icon_sz))
                self.screen.blit(icon, (cx, mid_y + i * row_h))
                cx += icon_sz + spacing

    def _animate_repulsion(
        self,
        path: list[Vec2],           # positions from start to landing
        piece: Piece,
        step_delay_ms: int = 200,   # pause between hops
    ) -> Vec2:
        """
        Visually moves *piece* along *path* (excluding the first square,
        because the pawn is already there).  The board grid is updated
        at each hop and the screen is redrawn.
        """
        for i in range(1, len(path)):
            prev_r, prev_c = path[i - 1]
            next_r, next_c = path[i]

            # vacate previous square and occupy next one
            self.board[prev_r][prev_c] = None
            self.board[next_r][next_c] = piece

            # redraw board + HUD so the hop is visible
            self._draw()
            pygame.time.delay(step_delay_ms)

        return path[-1]   # let the caller know where the pawn landed

    def _draw_square_flashes(self) -> None:
        if not self._flash_effects:
            return

        now = pygame.time.get_ticks()
        overlay = pygame.Surface((self.cfg.SQ_SIZE, self.cfg.SQ_SIZE), pygame.SRCALPHA)

        # total duration in milliseconds:
        total = int(self.cfg.FLASH_DURATION * 500)
        half  = total // 2

        expired: list[Vec2] = []
        for (r, c), start in self._flash_effects.items():
            elapsed = now - start
            if elapsed > total:
                expired.append((r, c))
                continue

            # alpha goes 0 → max → 0 over the full duration
            alpha = int(160 * (1 - abs(elapsed - half) / half))
            overlay.fill((*self.cfg.GREEN, alpha))
            self.screen.blit(overlay, (c * self.cfg.SQ_SIZE, r * self.cfg.SQ_SIZE))

        for key in expired:
            del self._flash_effects[key]

    def _animate_king_attack(self, pos: Vec2) -> None:
        """Flash a red-orange shock ring where the King stands."""
        r, c = pos
        center = (c * self.cfg.SQ_SIZE + self.cfg.SQ_SIZE // 2,
                r * self.cfg.SQ_SIZE + self.cfg.SQ_SIZE // 2)

        max_radius = self.cfg.SQ_SIZE // 2
        start = pygame.time.get_ticks()
        duration = 600  # ms
        clock = pygame.time.Clock()

        while pygame.time.get_ticks() - start < duration:
            self._draw()  # redraw board
            elapsed = pygame.time.get_ticks() - start
            progress = elapsed / duration

            radius = int(max_radius * progress)
            alpha = int(255 * (1 - progress))

            # Create a semi-transparent surface
            overlay = pygame.Surface((self.cfg.SQ_SIZE * self.cfg.COLS, self.cfg.SQ_SIZE * self.cfg.ROWS), pygame.SRCALPHA)
            ring = pygame.Surface((self.cfg.SQ_SIZE * self.cfg.COLS, self.cfg.SQ_SIZE * self.cfg.ROWS), pygame.SRCALPHA)
            pygame.draw.circle(ring, (255, 100, 0), center, radius, width=4)
            ring.set_alpha(alpha)
            overlay.blit(ring, (0, 0))


            self.screen.blit(overlay, (0, 0))
            pygame.display.flip()
            clock.tick(60)



    def _flash_winner_king(self, winner: str,
                           duration_ms: int = 3_000,
                           colour: Tuple[int, int, int] | None = None) -> None:
        """Highlight *winner*’s King, then stop the game."""
        if colour is None:
            colour = (255, 0, 0) if winner == "Black" else (255, 0, 0)

        # locate the King -------------------------------------------------
        king_pos: Vec2 | None = None
        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                p = self.board[r][c]
                if p and p.type == "King" and p.player == winner:
                    king_pos = (r, c)
                    break
            if king_pos:
                break
        if king_pos is None:                        # should never happen
            return

        r, c = king_pos
        overlay = pygame.Surface(
            (self.cfg.SQ_SIZE, self.cfg.SQ_SIZE), pygame.SRCALPHA
        )

        # blink loop -----------------------------------------------------
        start = pygame.time.get_ticks()
        while pygame.time.get_ticks() - start < duration_ms:
            self._draw()                    # redraw board + HUD
            alpha = 120 if ((pygame.time.get_ticks() - start) // 100) % 2 == 0 else 0
            overlay.fill((*colour, alpha))
            self.screen.blit(
                overlay, (c * self.cfg.SQ_SIZE, r * self.cfg.SQ_SIZE)
            )
            pygame.display.flip()
            pygame.time.delay(50)

        # self.running = False                # end the game gracefully


    def _draw_placement_overlay(self) -> None:
        if not self.placing:
            return

        player = AssaltoRealeGame.players[self.current_player]
        ptype = self.board.next_piece_type_for(player, self.pieces_left)
        if ptype is None:          # should never happen, but be safe
            return

        # a semi–transparent surface we can reuse
        tint = pygame.Surface((self.cfg.SQ_SIZE, self.cfg.SQ_SIZE), pygame.SRCALPHA)
        # slightly‑dark gray taken from cfg.HIGHLIGHT, but with alpha
        tint.fill((*self.cfg.HIGHLIGHT, 80))        # RGBA

        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                # a square is legal iff it is empty and *not* forbidden
                if (
                    self.board[r][c] is None and
                    not self.board.square_disallowed_for_placement(r, c, player, ptype)
                ):
                    self.screen.blit(tint, (c * self.cfg.SQ_SIZE, r * self.cfg.SQ_SIZE))


    # ======================== helpers =============================== #
    def _compute_valid_moves(self, piece: Piece, pos: Vec2) -> List[Vec2]:
        moves: List[Vec2] = []
        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                if piece.valid_move(self.board, pos, (r, c), self.moves_this_turn):
                    moves.append((r, c))
        return moves
    
    def _check_special_squares(self) -> None:
        black = len(self.board.controlled_squares["Black"])
        white = len(self.board.controlled_squares["White"])

        if self.both_at_four:
            return

        if self.candidate_winner is None:
            if black >= 3 and white >= 3:
                self.both_at_four = True
            elif black >= 3:
                self.candidate_winner = "Black"
                self.candidate_turn_index = self.turn_counter
            elif white >= 3:
                self.candidate_winner = "White"
                self.candidate_turn_index = self.turn_counter
        else:
            if black >= 3 and white >= 3:
                self.both_at_four = True

    def _check_candidate_win(self) -> None:
        if (self.candidate_winner is not None and
                self.turn_counter - (self.candidate_turn_index or 0) >= 2):
            if len(self.board.controlled_squares[self.candidate_winner]) >= 3:
                self._show_endgame_menu(self.candidate_winner)
            else:
                # lost control → cancel pending win
                self.candidate_winner = None

    def _animate_slide(
    self,
    start: Vec2,
    end: Vec2,
    piece: Piece,
    duration_ms: int = 200,
    ) -> None:
        """
        Fa scorrere il pezzo da start a end in pixel, interpolando
        in duration_ms millisecondi.
        """
        # calcola posizioni in pixel
        sx = start[1] * self.cfg.SQ_SIZE + self.cfg.SQ_SIZE // 2
        sy = start[0] * self.cfg.SQ_SIZE + self.cfg.SQ_SIZE // 2
        ex = end[1] * self.cfg.SQ_SIZE + self.cfg.SQ_SIZE // 2
        ey = end[0] * self.cfg.SQ_SIZE + self.cfg.SQ_SIZE // 2

        img = self.assets.piece_images[piece.player][piece.type]
        clock = pygame.time.Clock()
        start_time = pygame.time.get_ticks()

        while True:
            now = pygame.time.get_ticks()
            t = min((now - start_time) / duration_ms, 1.0)
            cx = int(sx + (ex - sx) * t)
            cy = int(sy + (ey - sy) * t)

            # disegna tutto tranne il pezzo in movimento
            self.board.draw(self.screen, self.font, self.selected, [])
            # disegna il pezzo “flottante”
            rect = img.get_rect(center=(cx, cy))
            self.screen.blit(img, rect)
            self._draw_hud()
            pygame.display.flip()

            if t >= 1.0:
                break
            clock.tick(60)




######################################################################
#                               Main                                 #
######################################################################

if __name__ == "__main__":
    AssaltoRealeGame().run()