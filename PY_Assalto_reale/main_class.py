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
    ASSETS_DIR: str = field(default_factory=lambda: os.path.join(os.path.dirname(__file__), "assets2"))


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
                if target.type == "DefensePawn" and board.defense_pawn_guards_king(re, ce):
                    return False
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
                if target.type == "DefensePawn" and board.defense_pawn_guards_king(re, ce):
                    return False
                return Board.is_allowed_capture_type(self, target)
            if (dr, dc) == (2, 2) and moves_this_turn == 0:
                mid_r, mid_c = (rs + re) // 2, (cs + ce) // 2
                if board[mid_r][mid_c] is not None:
                    return False
                if target.type == "DefensePawn" and board.defense_pawn_guards_king(re, ce):
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
        if target:
            return False
        return max(dr, dc) == 1 and target is None


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
    def _generate_special_squares(self) -> None:
        attempts = 0
        while len(self.special_squares) < 5 and attempts < 100_000:
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
        for r in range(cfg.ROWS):
            label = font.render(str(cfg.ROWS - r), True, cfg.BLACK)
            surface.blit(label, (cfg.WIDTH - cfg.RIGHT_MARGIN + 10, r * cfg.SQ_SIZE + cfg.SQ_SIZE / 2 - label.get_height() / 2))
        for c in range(cfg.COLS):
            letter_lbl = font.render(chr(ord("A") + c), True, cfg.BLACK)
            surface.blit(letter_lbl, (c * cfg.SQ_SIZE + cfg.SQ_SIZE / 2 - letter_lbl.get_width() / 2, cfg.ROWS * cfg.SQ_SIZE + 5))

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



class AssaltoRealeGame:
    players = ["Black", "White"]

    # ------------------------------------------------------------------ #
    def __init__(self):
        self.cfg = GameConfig()
        self.assets = AssetLoader(self.cfg)

        # pygame --------------------------------------------------------
        pygame.init()
        self.screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
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
        self.BUTTON_W, self.BUTTON_H = 125, 50
        self.BUTTON_X = self.cfg.WIDTH - 140
        self.BUTTON_Y = self.cfg.HEIGHT // 2 - 25

        self.SCOREBOARD_X, self.SCOREBOARD_Y = self.BUTTON_X, self.BUTTON_Y - 88
        self.CAPTURE_COUNTER_X, self.CAPTURE_COUNTER_Y = self.cfg.WIDTH - 200, self.cfg.HEIGHT - 312

        self.PLACEMENT_ICON_W, self.PLACEMENT_ICON_H = 125, 63
        self.PLACEMENT_ICON_X = self.SCOREBOARD_X - 113
        self.PLACEMENT_ICON_Y = self.SCOREBOARD_Y + 82

        self.UNDO_W, self.UNDO_H = 60, 50
        self.UNDO_X = self.SCOREBOARD_X
        self.UNDO_Y = self.PLACEMENT_ICON_Y + self.PLACEMENT_ICON_H + 20

        self.RESET_W = self.QUIT_W = 125
        self.RESET_H = self.QUIT_H = 50
        self.RESET_X = self.SCOREBOARD_X
        self.RESET_Y = self.UNDO_Y + self.UNDO_H + 20
        self.QUIT_X = self.RESET_X
        self.QUIT_Y = self.RESET_Y + self.RESET_H + 20

        # ─── Save‑moves button ────────────────────────────────────────────
        self.SAVE_W, self.SAVE_H = 125, 50
        self.SAVE_X = self.BUTTON_X
        self.SAVE_Y = self.QUIT_Y + self.QUIT_H + 20




    # =============================== main loop ======================= #
    def run(self) -> None:
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
        self.menu_buttons['save'] = pygame.Rect(cx - w//2, cy,          w, h)
        self.menu_buttons['quit'] = pygame.Rect(cx - w//2, cy + h + 20, w, h)

    
    def _format_game_history(self) -> str:
        lines: list[str] = []
        # 1) Placements
        lines.append("# PLACEMENTS")
        for i, p in enumerate(self.placement_history, start=1):
            row, col = p["pos"]
            sq = f"{chr(ord('A')+col)}{self.cfg.ROWS-row}"
            lines.append(f"{i}. {p['player']} places {p['type']} on {sq}")

        # 2) Moves
        lines.append("")           # blank line
        lines.append("# MOVES")
        for i, m in enumerate(self.move_history, start=1):
            piece     = m["piece"]
            fr, to    = m["from"], m["to"]
            start_sq  = f"{chr(ord('A')+fr[1])}{self.cfg.ROWS-fr[0]}"
            end_sq    = f"{chr(ord('A')+to[1])}{self.cfg.ROWS-to[0]}"
            captured  = m["captured"]
            # capture description
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
        print(f"Moves saved to {filename}")

    def _parse_game_file(self, filename: str) -> tuple[list[dict], list[dict]]:
        """
        Returns (placements, moves), where:
            - placements is a list of {"player","type","pos"}
            - moves is a list of {"player","type","start","end","captured"}
        """
        with open(filename, "r", encoding="utf-8") as f:
            section = "placements"
            placements: list[dict] = []
            moves:      list[dict] = []
            for raw in f:
                line = raw.strip()
                if not line:
                    continue
                # switch section on marker
                if line.upper().startswith("# MOVES"):
                    section = "moves"
                    continue
                if line.startswith("#"):
                    continue

                # drop the leading "n. "
                try:
                    _, content = line.split(" ", 1)
                except ValueError:
                    content = line

                if section == "placements":
                    # content e.g. "White places AttackPawn on B3"
                    parts = content.split()
                    player, _, ptype, _, sq = parts  # unpack 5 tokens
                    col = ord(sq[0].upper()) - ord("A")
                    row = self.cfg.ROWS - int(sq[1:])
                    placements.append({"player": player, "type": ptype, "pos": (row, col)})
                else:
                    # content e.g. "Black DefensePawn A2→A3 captured Pawn"
                    mv = self._parse_single_move(content)
                    moves.append(mv)

            return placements, moves


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
        if self.menu_buttons['save'].collidepoint(x,y):
            self._save_moves_to_file()
        elif self.menu_buttons['quit'].collidepoint(x,y):
            pygame.quit()
            sys.exit()
    


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
        if self._within(x, y, self.BUTTON_X, self.BUTTON_Y, self.BUTTON_W, self.BUTTON_H):
            self._end_turn()
            return
        if self._within(x, y, self.RESET_X, self.RESET_Y, self.RESET_W, self.RESET_H):
            self.__init__()  # cheap reset
            return
        if self._within(x, y, self.QUIT_X, self.QUIT_Y, self.QUIT_W, self.QUIT_H):
            self.running = False
            return
            # in _on_click, after your other button‐checks:
        if self._within(x, y, self.SAVE_X, self.SAVE_Y, self.SAVE_W, self.SAVE_H):
            self._save_moves_to_file("moves.txt")
            return



        # --- board interaction ----------------------------------------
        col, row = x // self.cfg.SQ_SIZE, y // self.cfg.SQ_SIZE
        if not (0 <= row < self.cfg.ROWS and 0 <= col < self.cfg.COLS):
            return

        if self.placing:
            self._handle_placement_click((row, col))
        else:
            self._handle_move_click((row, col))

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

        if "transformation" in last:
            t = last["transformation"]
            tr_r, tr_c = t["pos"]
            player = t["player"]
            old_type = t["old_type"]
            self.board.grid[tr_r][tr_c] = Piece.create(old_type, player)
            self.board.transform_squares.clear()
            if t["old_square"] is not None:
                self.board.transform_squares.add(t["old_square"])

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
        # semi‑transparent overlay
        overlay = pygame.Surface((self.SCR_W, self.SCR_H), pygame.SRCALPHA)
        overlay.fill((0,0,0,180))
        self.screen.blit(overlay, (0,0))

        # title
        txt = f"{self.menu_winner} wins"
        surf = self.font.render(txt, True, self.cfg.WHITE)
        self.screen.blit(surf, surf.get_rect(center=(self.SCR_W//2, self.SCR_H//2 - 80)))

        # buttons
        for name, rect in self.menu_buttons.items():
            color = self.cfg.BUTTON_COLOR
            pygame.draw.rect(self.screen, color, rect)
            label = "Save moves" if name=='save' else "Quit"
            txt_surf = self.font.render(label, True, self.cfg.BLACK)
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
                            old_square = None
                            if self.board.transform_squares:
                                old_square = next(iter(self.board.transform_squares))
                            self.board.grid[pos[0]][pos[1]] = Piece.create(new_type, player)
                            self.board.move_transform_square()
                            new_square = None
                            if self.board.transform_squares:
                                new_square = next(iter(self.board.transform_squares))
                            if self.move_history:
                                self.move_history[-1]["transformation"] = {
                                    "pos": pos,
                                    "player": player,
                                    "old_type": piece.type,
                                    "new_type": new_type,
                                    "old_square": old_square,
                                    "new_square": new_square,
                                }
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

        bx = self.BUTTON_X + self.BUTTON_W // 2
        by = self.BUTTON_Y - 150
        wx = bx
        wy = by + 28

        # background rectangles for readability
        for (tx, ty, colour, txt) in [
            (bx, by, cfg.BLACK, black_t),
            (wx, wy, cfg.WHITE, white_t),
        ]:
            surf = self.time_font.render(txt, True, colour)
            rect = surf.get_rect(center=(tx, ty))
            pygame.draw.rect(self.screen, cfg.GRAY, rect.inflate(8, 4))
            self.screen.blit(surf, rect)

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

        # --- save moves -----------------------------------------------
        pygame.draw.rect(self.screen, cfg.BUTTON_COLOR,
                        (self.SAVE_X, self.SAVE_Y, self.SAVE_W, self.SAVE_H))
        pygame.draw.rect(self.screen, cfg.BLACK,
                        (self.SAVE_X, self.SAVE_Y, self.SAVE_W, self.SAVE_H), 2)
        label = self.font.render("SAVE", True, cfg.WHITE)
        lx = self.SAVE_X + (self.SAVE_W - label.get_width()) // 2
        ly = self.SAVE_Y + (self.SAVE_H - label.get_height()) // 2
        self.screen.blit(label, (lx, ly))



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