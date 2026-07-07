from __future__ import annotations

import asyncio
import json
import os
import sys
import copy
import math
import random
from typing import Dict, List, Optional, Tuple

import pygame

from assalto_core import Board, DefendedKingPreview, GameConfig, Piece, Vec2
from assalto_assets import AssetLoader
from assalto_render import draw_board


class AssaltoRealeApp:
    players = ["Black", "White"]

    # ------------------------------------------------------------------ #

    def __init__(self):
        # --- config -----------------------------------------------------
        self.cfg = GameConfig()

        # --- pygame init (pygbag-safe: no FULLSCREEN) ------------------
        pygame.init()
        # Web (pygbag) can fail to create an SDL renderer when using pygame.SCALED.
        # Prefer the most compatible window-surface mode, with a safe fallback.
        try:
            flags = pygame.RESIZABLE
            self.screen = pygame.display.set_mode((self.cfg.WIDTH, self.cfg.HEIGHT), flags)
        except pygame.error:
            self.screen = pygame.display.set_mode((self.cfg.WIDTH, self.cfg.HEIGHT))
        self.SCR_W, self.SCR_H = self.screen.get_size()
        pygame.display.set_caption("Assalto Reale – OOP edition")
        self.clock = pygame.time.Clock()

        # fonts: SysFont might be missing on web; fall back to default
        try:
            self.font = pygame.font.SysFont("bookmanoldstyle", 20)
        except Exception:
            self.font = pygame.font.Font(None, 20)
        try:
            self.time_font = pygame.font.SysFont("bookmanoldstyle", 26, bold=True)
        except Exception:
            self.time_font = pygame.font.Font(None, 26)

        # assets (load AFTER display is set)
        self.assets = AssetLoader(self.cfg)

        # --- menu background (optional) --------------------------------
        # On web (pygbag), any failing image decode would otherwise crash the menu.
        # Always keep a safe fallback Surface.
        self.menu_background = pygame.Surface((self.SCR_W, self.SCR_H))
        self.menu_background.fill((30, 30, 30))
        try:
            bg_path = os.path.join(self.cfg.ASSETS_DIR, "background_MENU.png")
            bg = pygame.image.load(bg_path).convert()
            self.menu_background = pygame.transform.smoothscale(bg, (self.SCR_W, self.SCR_H))
        except Exception:
            # keep fallback
            pass

        # --- menu settings ---------------------------------------------
        self.timer_options   = [0, 5*60, 10*60, 12*60, 15*60, 20*60]
        self.timer_index     = 3
        self.board_sizes     = [(12, 12)]
        self.board_index     = 0
        self.special_options = [5]
        self.special_index   = 0
        self.settings: Dict[str, object] = {}

        self.opponent_options = ["Human", "Computer"]
        self.opponent_index   = 0
        self.human_side_options = ["Black", "White", "Random"]
        self.human_side_index = 0
        self.ai_difficulty_options = ["Easy", "Medium", "Hard"]
        self.ai_difficulty_index = 1
        self.transform_options = ["Off", "On"]
        self.transform_index = 0
        self.placement_mode_options = ["Manual", "Quick Balanced"]
        self.placement_mode_index = 0
        # single-player mode (set per match in the start menu)
        self.vs_ai: bool = False
        self.ai_side: str = "White"   # AI plays White by default
        self.human_side: str = "Black"
        self.untimed: bool = False




        # --- AI pacing (ms) ---------------------------------------------
        # Makes the Computer feel more "human": one action every N ms
        self.ai_delay_ms_move: int = 650     # pause between AI moves
        self.ai_delay_ms_place: int = 200    # faster placements
        self.ai_move_anim_ms: int = 320      # slower slide animation for AI moves
        self._ai_next_tick: int = 0


        # --- AI strength --------------------------------------------------
        # Turn-level minimax depth (in *turns*). 3 = [AI now] + [opp reply] + [AI next].
        # Higher is stronger but slower on web.
        self.ai_depth_turns: int = 3

        # Candidate limiting per action inside a turn (controls branching).
        self.ai_topk1: int = 18   # first action options
        self.ai_topk2: int = 14   # second action options

        # Hard cap on number of full-turn sequences considered at each node.
        self.ai_max_sequences: int = 42

        # Time budget per AI decision (ms). Prevents long freezes on the browser.
        self.ai_time_budget_ms: int = 260

        # Transposition table (reset each turn) to reuse evaluated positions.
        self._ai_tt: Dict[Tuple, float] = {}
        # --- audio ------------------------------------------------------
        # Desktop pygame: audio is usually available immediately.
        # Web (pygbag): browsers often BLOCK audio until the first user gesture
        # (click/tap/key press). If mixer init fails at boot, we will retry later.
        self._audio_unlocked: bool = False
        self._audio_unlock_failed: bool = False
        self._audio_last_unlock_attempt_ms: int = 0

        # Victory SFX is loaded lazily after audio unlock (see _ensure_audio()).
        self._victory_played: bool = False
        self.victory_sound = None
        # --- clocks -----------------------------------------------------
        self.time_left   = {"Black": 12 * 60.0, "White": 12 * 60.0}
        self._last_tick  = pygame.time.get_ticks()

        # --- core state -------------------------------------------------
        self.placement_history: list[dict] = []
        self.board = Board(self.cfg)
        self._flash_effects: dict[Vec2, int] = {}
        self.current_player: int = 0  # index into players
        self.moves_this_turn: int = 0
        self.king_moved: bool = False
        self.selected: Optional[Vec2] = None
        self.hover_cell: Optional[Vec2] = None  # hover preview (no click)
        self.defended_king_preview: Optional[DefendedKingPreview] = None
        self.defended_king_preview_start: Optional[Vec2] = None
        self.defended_king_preview_target: Optional[Vec2] = None
        self.defended_king_preview_locked: bool = False
        self.running: bool = True
        # menu/game flow flags
        self.return_to_menu: bool = False

        # lightweight in-game notifications (toast)
        self.toast_message: Optional[str] = None
        self.toast_until_ms: int = 0

        # rules/help (start-menu info button)
        self._rules_img_cache: dict[tuple[str,int,int], pygame.Surface] = {}
        self.candidate_winner: Optional[str] = None
        self.candidate_turn_index: Optional[int] = None
        self.turn_counter: int = 0
        self.last_move: Optional[Tuple[Vec2, Vec2]] = None

        # endgame menu state
        self.menu_active: bool = False
        self.menu_winner: Optional[str] = None
        self.menu_buttons: dict[str, pygame.Rect] = {}

        # placement phase
        self.placing: bool = True
        self.pieces_left: Dict[str, Dict[str, int]] = {
            "Black": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
            "White": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
        }
        self.pieces_placed: Dict[str, int] = {"Black": 0, "White": 0}
        self.turn_sequence: List[int] = [1] + [2] * 12 + [1]
        self.turn_index: int = 0
        self.turn_pieces_count: int = 0

        # undo history
        self.move_history: List[dict] = []

        # responsive layout (board surface + HUD)
        self._layout_sig = None
        self._assets_sq = None
        self._apply_responsive_layout(force=True)

    def _apply_responsive_layout(self, *, force: bool = False) -> None:
        """Recompute board + HUD layout to fit the current window.

        Goal: never cut the HUD off-screen. If there isn't enough horizontal
        space, the HUD is placed below the board.
        """
        w, h = self.screen.get_size()
        sig = (w, h, self.cfg.ROWS, self.cfg.COLS)
        if (not force) and getattr(self, "_layout_sig", None) == sig:
            return
        self._layout_sig = sig
        self.SCR_W, self.SCR_H = w, h

        # --- tunables ---------------------------------------------------
        margin = 20
        coord_pad = 56          # space for A-L / 1-12 labels (right + bottom)
        desired_hud_w = 280     # target HUD width when on the right
        min_sq = 24             # minimum readable square size

        rows, cols = self.cfg.ROWS, self.cfg.COLS

        def side_sq() -> int:
            avail_w = w - (3 * margin) - desired_hud_w - coord_pad
            avail_h = h - (2 * margin) - coord_pad
            return min(avail_w // cols, avail_h // rows)

        sq = side_sq()
        side_ok = sq >= min_sq

        if side_ok:
            layout = "side"
            hud_w = desired_hud_w
            # keep inside the window even if the right area is slightly smaller
            sq = max(min_sq, sq)
            board_w = cols * sq
            board_h = rows * sq
            surf_w = board_w + coord_pad
            surf_h = board_h + coord_pad

            bx, by = margin, margin
            self.board_surf_rect = pygame.Rect(bx, by, surf_w, surf_h)
            self.board_grid_rect = pygame.Rect(bx, by, board_w, board_h)

            hx = self.board_surf_rect.right + margin
            hw = max(200, w - hx - margin)
            self.hud_rect = pygame.Rect(hx, margin, hw, h - 2 * margin)
        else:
            layout = "bottom"
            # reserve space for HUD below
            min_hud_h = 320
            avail_w = w - (2 * margin) - coord_pad
            avail_h = h - (3 * margin) - min_hud_h - coord_pad
            sq = max(min_sq, min(avail_w // cols, avail_h // rows))

            board_w = cols * sq
            board_h = rows * sq
            surf_w = board_w + coord_pad
            surf_h = board_h + coord_pad

            bx, by = margin, margin
            self.board_surf_rect = pygame.Rect(bx, by, surf_w, surf_h)
            self.board_grid_rect = pygame.Rect(bx, by, board_w, board_h)

            hy = self.board_surf_rect.bottom + margin
            hh = max(180, h - hy - margin)
            self.hud_rect = pygame.Rect(margin, hy, surf_w, hh)

        # update cfg square size (frozen dataclass)
        object.__setattr__(self.cfg, "SQ_SIZE", int(sq))

        # (re)create the offscreen board surface
        self.board_surface = pygame.Surface((self.board_surf_rect.w, self.board_surf_rect.h)).convert_alpha()

        # fonts: scale with sq (web-safe fallback)
        base = max(16, int(sq * 0.33))
        tsize = max(20, int(sq * 0.45))
        try:
            self.font = pygame.font.SysFont("bookmanoldstyle", base)
        except Exception:
            self.font = pygame.font.Font(None, base)
        try:
            self.time_font = pygame.font.SysFont("bookmanoldstyle", tsize, bold=True)
        except Exception:
            self.time_font = pygame.font.Font(None, tsize)

        # reload assets if sq changed or first time
        if getattr(self, "_assets_sq", None) != int(sq) or force:
            self.assets = AssetLoader(self.cfg)
            self._assets_sq = int(sq)

        # recompute HUD geometry inside the HUD rect
        self._init_ui_geometry(layout=layout)

    def _init_ui_geometry(self, *, layout: str = "side") -> None:
        """Compute HUD widget positions inside self.hud_rect."""
        pad_x = 20
        pad_y = 20
        x0 = self.hud_rect.x + pad_x
        y = self.hud_rect.y + pad_y
        inner_w = max(180, self.hud_rect.w - 2 * pad_x)

        # unify widths so everything fits
        full_w = min(260, inner_w)
        btn_w = full_w
        btn_h = 48

        # ─── Scoreboard ────────────────────────────────────────────────
        self.SCOREBOARD_W, self.SCOREBOARD_H = full_w, 112
        self.SCOREBOARD_X = x0
        self.SCOREBOARD_Y = y
        y += self.SCOREBOARD_H + 16

        # ─── Placement icon ────────────────────────────────────────────
        self.PLACEMENT_ICON_W, self.PLACEMENT_ICON_H = full_w, 64
        self.PLACEMENT_ICON_X = x0
        self.PLACEMENT_ICON_Y = y
        y += self.PLACEMENT_ICON_H + 16

        # ─── Timer panel ──────────────────────────────────────────────
        self.TIMER_W, self.TIMER_H = full_w, 80
        self.TIMER_X = x0 + self.TIMER_W // 2
        self.TIMER_Y = y + 22
        y += self.TIMER_H + 16

        # ─── Undo button ───────────────────────────────────────────────
        self.UNDO_W, self.UNDO_H = min(80, btn_w), btn_h
        self.UNDO_X = x0
        self.UNDO_Y = y
        y += self.UNDO_H + 12

        # ─── PASS / TURN button ────────────────────────────────────────
        self.BUTTON_W, self.BUTTON_H = btn_w, btn_h
        self.BUTTON_X = x0
        self.BUTTON_Y = y
        y += self.BUTTON_H + 12

        # ─── Reset button ──────────────────────────────────────────────
        self.RESET_W, self.RESET_H = btn_w, btn_h
        self.RESET_X = x0
        self.RESET_Y = y
        y += self.RESET_H + 12

        # ─── Quit button ───────────────────────────────────────────────
        self.QUIT_W, self.QUIT_H = btn_w, btn_h
        self.QUIT_X = x0
        self.QUIT_Y = y
        y += self.QUIT_H + 12

        # ─── Save button ───────────────────────────────────────────────
        self.SAVE_W, self.SAVE_H = btn_w, btn_h
        self.SAVE_X = x0
        self.SAVE_Y = y
        y += self.SAVE_H + 12

        # ─── Load button ───────────────────────────────────────────────
        self.LOAD_W, self.LOAD_H = btn_w, btn_h
        self.LOAD_X = x0
        self.LOAD_Y = y
        y += self.LOAD_H + 12

    

        # ─── Capture counter (captured pieces) ─────────────────────────
        # Place it inside the HUD without going off-screen; if space is tight,
        # anchor it near the bottom of the HUD.
        pad = 20
        counter_w = min(250, max(160, self.hud_rect.w - 2 * pad))
        counter_h = min(256, max(120, self.hud_rect.h - 2 * pad))
        x = self.hud_rect.centerx - counter_w // 2
        x = max(self.hud_rect.left + pad, min(x, self.hud_rect.right - pad - counter_w))

        y_candidate = y + 8  # below the last button
        y_bottom = self.hud_rect.bottom - pad - counter_h
        y = y_candidate if y_candidate <= y_bottom else max(self.hud_rect.top + pad, y_bottom)

        self.CAPTURE_COUNTER_W, self.CAPTURE_COUNTER_H = counter_w, counter_h
        self.CAPTURE_COUNTER_X, self.CAPTURE_COUNTER_Y = int(x), int(y)

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
        self._apply_responsive_layout(force=True)
        # 5) rebuild board with exactly the same # special squares
        self.board = Board(self.cfg)
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
        self.king_moved       = False
        self.turn_counter     = 0
        self.menu_active      = False


    

    def _reset_match_state(self) -> None:
        """Reset per-game state without reinitializing pygame.

        This is important on the web (pygbag/Vercel) where repeatedly calling
        pygame.init()/set_mode can be fragile.
        """
        self.placement_history = []
        self._flash_effects = {}
        self.current_player = 0
        self.moves_this_turn = 0
        self.king_moved = False
        self.selected = None
        self._clear_defended_king_preview()
        self._victory_played = False
        self.candidate_winner = None
        self.candidate_turn_index = None
        self.turn_counter = 0
        self.last_move = None

        # endgame menu state
        self.menu_active = False
        self.menu_winner = None
        self.menu_buttons = {}

        # placement phase
        self.placing = True
        self.pieces_left = {
            "Black": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
            "White": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
        }
        self.pieces_placed = {"Black": 0, "White": 0}
        self.turn_sequence = [1] + [2] * 12 + [1]
        self.turn_index = 0
        self.turn_pieces_count = 0

        # undo history
        self.move_history = []

        # toast
        self.toast_message = None
        self.toast_until_ms = 0

        self.return_to_menu = False

    def _configure_ai_difficulty(self, difficulty: str) -> None:
        if difficulty == "Easy":
            self.ai_depth_turns = 1
            self.ai_topk1 = 10
            self.ai_topk2 = 6
            self.ai_max_sequences = 18
            self.ai_time_budget_ms = 90
        elif difficulty == "Hard":
            self.ai_depth_turns = 3
            self.ai_topk1 = 22
            self.ai_topk2 = 16
            self.ai_max_sequences = 56
            self.ai_time_budget_ms = 320
        else:
            self.ai_depth_turns = 2
            self.ai_topk1 = 16
            self.ai_topk2 = 12
            self.ai_max_sequences = 36
            self.ai_time_budget_ms = 200

    def _apply_quick_balanced_setup(self) -> None:
        self.board.validate_placement_schedule()
        self.board.grid = [[None for _ in range(self.cfg.COLS)] for _ in range(self.cfg.ROWS)]
        self.placement_history.clear()
        self.pieces_left = {
            "Black": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
            "White": {"AttackPawn": 4, "DefensePawn": 4, "ConquestPawn": 4, "King": 1},
        }
        self.pieces_placed = {"Black": 0, "White": 0}

        for step in Board.PLACEMENT_SCHEDULE:
            for _ in range(step.count):
                ptype = self.board.next_piece_type_for(step.player, self.pieces_left)
                if ptype is None:
                    raise RuntimeError(f"No piece left for {step.player}")
                pos = self._choose_quick_placement_square(step.player, ptype)
                if pos is None:
                    raise RuntimeError(f"No legal quick placement for {step.player} {ptype}")
                self.board.place_piece(pos, step.player, ptype)
                self.placement_history.append({"player": step.player, "type": ptype, "pos": pos})
                self.pieces_left[step.player][ptype] -= 1
                self.pieces_placed[step.player] += 1

        self._set_placement_progress_from_count(len(self.placement_history))
        self.moves_this_turn = 0
        self.king_moved = False
        self.board.update_control()

    def _choose_quick_placement_square(self, player: str, ptype: str) -> Optional[Vec2]:
        king_pos = self._find_king_pos(player)
        center_r = self.cfg.ROWS // 2
        if ptype == "King":
            anchor = (center_r, self.cfg.COLS // 4 if player == "Black" else (3 * self.cfg.COLS) // 4)
        elif ptype == "AttackPawn":
            anchor = (center_r, 0 if player == "Black" else self.cfg.COLS - 1)
        elif ptype == "DefensePawn" and king_pos is not None:
            anchor = king_pos
        elif ptype == "ConquestPawn" and self.board.special_squares:
            own_file = 2 if player == "Black" else self.cfg.COLS - 3
            anchor = (center_r, own_file)
        else:
            anchor = (center_r, self.cfg.COLS // 2)

        best: Optional[Vec2] = None
        best_score = -1e18
        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                pos = (r, c)
                if not self.board.can_place_piece(pos, player, ptype).ok:
                    continue
                score = -2.0 * (abs(r - anchor[0]) + abs(c - anchor[1]))
                if ptype == "DefensePawn" and king_pos is not None:
                    d = max(abs(r - king_pos[0]), abs(c - king_pos[1]))
                    if d == 1:
                        score += 100
                    elif d == 2:
                        score += 30
                if ptype == "ConquestPawn" and self.board.special_squares:
                    d = min(max(abs(r - sr), abs(c - sc)) for sr, sc in self.board.special_squares)
                    score += 60.0 / max(1, d)
                if player == "White":
                    score += 0.01 * c
                else:
                    score -= 0.01 * c
                if score > best_score:
                    best_score = score
                    best = pos
        return best
    async def _show_start_menu(self) -> None:
            # Fonts and image codecs can differ between desktop and web.
            # Keep the menu resilient: if a font or a JPEG decode fails, we still render.
            try:
                title_f = pygame.font.SysFont("bookmanoldstyle", 48, bold=True)
                sub_f   = pygame.font.SysFont("bookmanoldstyle", 30)
                sec_f   = pygame.font.SysFont("bookmanoldstyle", 26, bold=True)
                body_f  = pygame.font.SysFont("bookmanoldstyle", 20)
            except Exception:
                title_f = pygame.font.Font(None, 48)
                sub_f   = pygame.font.Font(None, 30)
                sec_f   = pygame.font.Font(None, 26)
                body_f  = pygame.font.Font(None, 20)

            # --- creators image (optional; JPEG may be unsupported on some builds)
            creator_img = None
            creator_pos = None
            caption_surf = None
            caption_pos = None
            try:
                creator_orig = None
                for fname in ("CREATORS.png", "CREATORS.jpeg", "CREATORS.jpg"):
                    try:
                        creator_orig = pygame.image.load(os.path.join(self.cfg.ASSETS_DIR, fname)).convert_alpha()
                        break
                    except Exception:
                        continue
                if creator_orig is not None:
                    creator_img  = pygame.transform.smoothscale(creator_orig, (120, 120))
            except Exception:
                creator_img = None

            def _refresh_menu_background() -> None:
                # Re-scale menu background on resize (avoid repeated scaling on an already-scaled surface)
                self.SCR_W, self.SCR_H = self.screen.get_size()
                fallback = pygame.Surface((self.SCR_W, self.SCR_H))
                fallback.fill((30, 30, 30))
                self.menu_background = fallback
                try:
                    bg_path = os.path.join(self.cfg.ASSETS_DIR, "background_MENU.png")
                    bg = pygame.image.load(bg_path).convert()
                    self.menu_background = pygame.transform.smoothscale(bg, (self.SCR_W, self.SCR_H))
                except Exception:
                    pass

            def _wrap_lines(font: pygame.font.Font, text: str, max_w: int) -> List[str]:
                words = text.replace("\n", " \n ").split(" ")
                lines: List[str] = []
                cur = ""
                for w in words:
                    if w == "\n":
                        if cur:
                            lines.append(cur)
                            cur = ""
                        lines.append("")
                        continue
                    test = (cur + " " + w).strip()
                    if font.size(test)[0] <= max_w or not cur:
                        cur = test
                    else:
                        lines.append(cur)
                        cur = w
                if cur:
                    lines.append(cur)
                return lines

            # Rules content (images are optional; you can add them later in /assets)
            rules_sections = [
                {
                    "title": "1) Objective",
                    "body": (
                        "Win in either of these ways:\n"
                        "• Capture the opponent’s King.\n"
                        "• OR control a strict majority of the 5 Special Squares and keep it through the opponent response turn.\n\n"
                        "Control means: your Conquest Pawn ends a move on a Special Square."
                    ),
                    "img": "rules_objective.png",
                },
                {
                    "title": "2) Board & Special Squares",
                    "body": (
                        "At the start, 5 Special Squares are generated with spacing between them.\n"
                        "Special Squares can never contain a piece during placement.\n\n"
                        "A Conquest Pawn standing on one gives its player control of that square."
                    ),
                    "img": "rules_special_squares_example.png",
                },
                {
                    "title": "3) Pieces and what they can capture",
                    "body": (
                        "There are 4 piece types per side:\n"
                        "• King\n"
                        "• Attack Pawn\n"
                        "• Defense Pawn\n"
                        "• Conquest Pawn\n\n"
                        "Capture rules (rock-paper-scissors-ish):\n"
                        "• Attack Pawn captures: King and Defense Pawn.\n"
                        "• Defense Pawn captures: Conquest Pawn.\n"
                        "• Conquest Pawn captures: Attack Pawn.\n"
                        "• King captures: any pawn type.\n"
                    ),
                    "img": "rules_capture_table.png",
                },
                {
                    "title": "4) Movement rules (normal moves)",
                    "body": (
                        "All pieces move 1 square for a normal (non-capture) move.\n"
                        "• Attack Pawn: 1 square in any direction.\n"
                        "• Defense Pawn: 1 square in any direction.\n"
                        "• Conquest Pawn: 1 square in any direction.\n"
                        "• King: 1 square (any direction)."
                    ),
                    "img": "rules_moves_normal.png",
                },
                {
                    "title": "5) Capture patterns (the spicy part)",
                    "body": (
                        "Attack Pawn captures orthogonally:\n"
                        "• 1-square orthogonal capture.\n"
                        "• OR a 2-square orthogonal capture (only if it is your FIRST move of the turn).\n"
                        "  For a 2-square capture, the middle square must be empty (special rule when capturing a defended King).\n\n"
                        "Defense Pawn captures diagonally:\n"
                        "• 1-square diagonal capture.\n"
                        "• OR a 2-square diagonal capture (only if it is your FIRST move of the turn) AND the middle square is empty.\n\n"
                        "Conquest Pawn captures by stepping onto an adjacent enemy Attack Pawn.\n"
                    ),
                    "img": "rules_captures_examples.png",
                },
                {
                    "title": "6) The defended King rule (bounce)",
                    "body": (
                        "If an Attack Pawn tries to capture a King that is protected by an adjacent friendly Defense Pawn:\n"
                        "• The Defense Pawn is sacrificed (removed).\n"
                        "• The Attack Pawn bounces directly backward along the attack line, up to 5 squares.\n"
                        "• The bounce stops before the board edge or any occupied square.\n\n"
                        "If the King is NOT protected, the capture succeeds and the game ends."
                    ),
                    "img": "rules_defended_king.png",
                },
                {
                    "title": "7) Two moves per turn",
                    "body": (
                        "Each player can make up to 2 moves per turn.\n"
                        "Some long captures (the 2-square ones) are only allowed as the FIRST move of your turn."
                    ),
                    "img": "rules_two_moves.png",
                },
                {
                    "title": "8) Transform Square (late-game twist)",
                    "body": (
                        "After enough turns, a special Transform Square may appear.\n"
                        "If a pawn ends its move on that square, it can transform into a different pawn type.\n\n"
                        "Idea for an image: show the transform icon on a square, and an arrow to the piece selection."
                    ),
                    "img": "rules_transform_square.png",
                },
                {
                    "title": "9) Saving & Loading",
                    "body": (
                        "Save writes a local file (moves.txt).\n"
                        "Load restores the last saved game.\n"
                        "On the web, saves may not persist across browsers/devices (it depends on the runtime), "
                        "but the game won’t crash if no save exists."
                    ),
                    "img": "rules_save_load.png",
                },
            ]

            # --- state for this menu session
            view: str = "main"   # "main" | "rules"
            rules_scroll: int = 0
            error_message: Optional[str] = None

            # Initial layout refresh (handles first render + any prior resizes)
            _refresh_menu_background()

            while True:
                for ev in pygame.event.get():
                    if ev.type == pygame.QUIT:
                        self.running = False
                        return

                    if ev.type == pygame.VIDEORESIZE:
                        try:
                            self.screen = pygame.display.set_mode((ev.w, ev.h), pygame.RESIZABLE)
                        except Exception:
                            self.screen = pygame.display.set_mode((ev.w, ev.h))
                        _refresh_menu_background()

                    if view == "main":
                        if ev.type == pygame.MOUSEBUTTONDOWN:
                            mx, my = ev.pos
                            self._ensure_audio()

                            # layout (recomputed on-the-fly, so clicks stay correct after resize)
                            btn_w, btn_h = 250, 60
                            start_btn = pygame.Rect((self.SCR_W - btn_w) // 2, self.SCR_H - 170, btn_w, btn_h)
                            load_btn  = pygame.Rect((self.SCR_W - btn_w) // 2, self.SCR_H - 100, btn_w, btn_h)

                            info_rect = pygame.Rect(self.SCR_W - 52, 12, 40, 40)

                            labels = ["Timer", "Opponent", "Human side", "AI difficulty", "Transform", "Placement"]
                            get_values = [
                                lambda: "Untimed" if self.timer_options[self.timer_index] == 0 else f"{self.timer_options[self.timer_index] // 60} min",
                                lambda: self.opponent_options[self.opponent_index],
                                lambda: self.human_side_options[self.human_side_index],
                                lambda: self.ai_difficulty_options[self.ai_difficulty_index],
                                lambda: self.transform_options[self.transform_index],
                                lambda: self.placement_mode_options[self.placement_mode_index],
                            ]
                            x_center   = self.SCR_W // 2
                            top_margin = 135
                            n          = len(labels)
                            total_h    = (self.SCR_H - top_margin) - 260
                            spacing_y  = max(64, total_h // (n + 1))

                            arrow_size = 40
                            gap        = 100

                            # info (rules)
                            if info_rect.collidepoint(mx, my):
                                view = "rules"
                                rules_scroll = 0
                                error_message = None
                                continue

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
                                        self.opponent_index = (self.opponent_index - 1) % len(self.opponent_options)
                                    elif i == 2:
                                        self.human_side_index = (self.human_side_index - 1) % len(self.human_side_options)
                                    elif i == 3:
                                        self.ai_difficulty_index = (self.ai_difficulty_index - 1) % len(self.ai_difficulty_options)
                                    elif i == 4:
                                        self.transform_index = (self.transform_index - 1) % len(self.transform_options)
                                    else:
                                        self.placement_mode_index = (self.placement_mode_index - 1) % len(self.placement_mode_options)

                                if right.collidepoint(mx, my):
                                    if i == 0:
                                        self.timer_index   = (self.timer_index   + 1) % len(self.timer_options)
                                    elif i == 1:
                                        self.opponent_index = (self.opponent_index + 1) % len(self.opponent_options)
                                    elif i == 2:
                                        self.human_side_index = (self.human_side_index + 1) % len(self.human_side_options)
                                    elif i == 3:
                                        self.ai_difficulty_index = (self.ai_difficulty_index + 1) % len(self.ai_difficulty_options)
                                    elif i == 4:
                                        self.transform_index = (self.transform_index + 1) % len(self.transform_options)
                                    else:
                                        self.placement_mode_index = (self.placement_mode_index + 1) % len(self.placement_mode_options)

                            # START NEW GAME
                            if start_btn.collidepoint(mx, my):
                                self.settings["timer"]         = self.timer_options[self.timer_index]
                                self.settings["board_size"]    = (12, 12)
                                self.settings["special_count"] = 5
                                self.settings["opponent"]     = self.opponent_options[self.opponent_index]
                                self.settings["human_side"]   = self.human_side_options[self.human_side_index]
                                self.settings["ai_difficulty"] = self.ai_difficulty_options[self.ai_difficulty_index]
                                self.settings["transform"]    = self.transform_options[self.transform_index] == "On"
                                self.settings["placement_mode"] = self.placement_mode_options[self.placement_mode_index]
                                self.settings["_action"]       = "new"
                                return

                            # LOAD SAVED GAME
                            if load_btn.collidepoint(mx, my):
                                if not self._has_saved_game("moves.txt"):
                                    error_message = "No saved game found."
                                    continue
                                try:
                                    self._load_moves_from_file("moves.txt")
                                    # keep menu in sync with what we loaded
                                    self.settings["timer"] = float(self.time_left["Black"])
                                    self.settings["board_size"] = (self.cfg.ROWS, self.cfg.COLS)
                                    self.settings["special_count"] = len(self.board.special_squares)
                                    self.settings["_action"] = "load"
                                    return
                                except Exception as e:
                                    error_message = str(e)

                    else:  # view == "rules"
                        if ev.type == pygame.KEYDOWN and ev.key == pygame.K_ESCAPE:
                            view = "main"
                            continue
                        if ev.type == pygame.MOUSEBUTTONDOWN:
                            mx, my = ev.pos
                            self._ensure_audio()
                            panel = pygame.Rect(60, 60, self.SCR_W - 120, self.SCR_H - 120)
                            back_rect = pygame.Rect(panel.left + 16, panel.top + 14, 96, 36)
                            if back_rect.collidepoint(mx, my):
                                view = "main"
                                continue
                        if ev.type == pygame.MOUSEWHEEL:
                            rules_scroll -= int(ev.y * 40)  # wheel up => y=+1 => scroll up
                        if ev.type == pygame.KEYDOWN:
                            if ev.key in (pygame.K_DOWN, pygame.K_PAGEDOWN):
                                rules_scroll += 60
                            elif ev.key in (pygame.K_UP, pygame.K_PAGEUP):
                                rules_scroll -= 60

                # ------------------ draw ------------------
                self.screen.blit(self.menu_background, (0, 0))

                if view == "main":
                    # layout values
                    btn_w, btn_h = 250, 60
                    start_btn = pygame.Rect((self.SCR_W - btn_w) // 2, self.SCR_H - 170, btn_w, btn_h)
                    load_btn  = pygame.Rect((self.SCR_W - btn_w) // 2, self.SCR_H - 100, btn_w, btn_h)

                    labels = ["Timer", "Opponent", "Human side", "AI difficulty", "Transform", "Placement"]
                    get_values = [
                        lambda: "Untimed" if self.timer_options[self.timer_index] == 0 else f"{self.timer_options[self.timer_index] // 60} min",
                        lambda: self.opponent_options[self.opponent_index],
                        lambda: self.human_side_options[self.human_side_index],
                        lambda: self.ai_difficulty_options[self.ai_difficulty_index],
                        lambda: self.transform_options[self.transform_index],
                        lambda: self.placement_mode_options[self.placement_mode_index],
                    ]
                    x_center   = self.SCR_W // 2
                    top_margin = 135
                    n          = len(labels)
                    total_h    = (self.SCR_H - top_margin) - 260
                    spacing_y  = max(64, total_h // (n + 1))
                    arrow_size = 40
                    gap        = 100

                    # Info button [i]
                    info_rect = pygame.Rect(self.SCR_W - 52, 12, 40, 40)
                    pygame.draw.ellipse(self.screen, (30, 30, 30), info_rect)
                    pygame.draw.ellipse(self.screen, (255, 255, 255), info_rect, 2)
                    i_surf = sub_f.render("i", True, (255, 255, 255))
                    self.screen.blit(i_surf, i_surf.get_rect(center=info_rect.center))

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
                    pygame.draw.rect(self.screen, (70,200,70), start_btn, border_radius=10)
                    st = sub_f.render("START", True, (0,0,0))
                    self.screen.blit(st, st.get_rect(center=start_btn.center))

                    # LOAD SAVED GAME button (dim if no save)
                    has_save = self._has_saved_game("moves.txt")
                    load_col = (70,150,230) if has_save else (70, 90, 120)
                    pygame.draw.rect(self.screen, load_col, load_btn, border_radius=10)
                    ld = sub_f.render("LOAD GAME", True, (0,0,0))
                    self.screen.blit(ld, ld.get_rect(center=load_btn.center))

                    # creators image + caption
                    if creator_img is not None:
                        creator_pos  = (130, self.SCR_H - 20 - creator_img.get_height())
                        self.screen.blit(creator_img, creator_pos)
                        caption_surf = sub_f.render("The creators of  Assalto Reale:", True, (255,255,255))
                        caption_pos  = (20, creator_pos[1] - creator_img.get_height()//2)
                        self.screen.blit(caption_surf, caption_pos)

                    # error overlay (load failures)
                    if error_message:
                        self._draw_error_overlay(error_message)

                else:
                    # RULES screen
                    overlay = pygame.Surface((self.SCR_W, self.SCR_H), pygame.SRCALPHA)
                    overlay.fill((0, 0, 0, 120))
                    self.screen.blit(overlay, (0, 0))

                    panel = pygame.Rect(60, 60, self.SCR_W - 120, self.SCR_H - 120)
                    pygame.draw.rect(self.screen, (20, 20, 20), panel, border_radius=16)
                    pygame.draw.rect(self.screen, (255, 255, 255), panel, 2, border_radius=16)

                    back_rect = pygame.Rect(panel.left + 16, panel.top + 14, 96, 36)
                    pygame.draw.rect(self.screen, (125, 125, 125), back_rect, border_radius=10)
                    back_txt = body_f.render("BACK", True, (0, 0, 0))
                    self.screen.blit(back_txt, back_txt.get_rect(center=back_rect.center))

                    title = sec_f.render("Rules of the game", True, (255, 255, 255))
                    self.screen.blit(title, (back_rect.right + 24, panel.top + 18))

                    inner = panel.inflate(-40, -120)  # space for header/back button
                    clip_rect = inner.copy()
                    self.screen.set_clip(clip_rect)

                    y = inner.top - rules_scroll
                    max_w = inner.width

                    # render sections and compute total height
                    total_h = 0
                    for sec in rules_sections:
                        # section title
                        t = sec_f.render(sec["title"], True, (230, 230, 230))
                        self.screen.blit(t, (inner.left, y))
                        y += t.get_height() + 8
                        total_h += t.get_height() + 8

                        # body
                        for line in _wrap_lines(body_f, sec["body"], max_w):
                            if line == "":
                                y += body_f.get_height() // 2
                                total_h += body_f.get_height() // 2
                                continue
                            s = body_f.render(line, True, (240, 240, 240))
                            self.screen.blit(s, (inner.left, y))
                            y += s.get_height() + 3
                            total_h += s.get_height() + 3

                        # image (optional)
                        img_name = sec.get("img")
                        if img_name:
                            box_w = min(max_w, 520)
                            box_h = 170
                            img_rect = pygame.Rect(inner.left, y + 6, box_w, box_h)

                            img = None
                            try:
                                key = (img_name, img_rect.w, img_rect.h)
                                if key in self._rules_img_cache:
                                    img = self._rules_img_cache[key]
                                else:
                                    p = os.path.join(self.cfg.ASSETS_DIR, img_name)
                                    raw = pygame.image.load(p).convert_alpha()
                                    img = pygame.transform.smoothscale(raw, (img_rect.w, img_rect.h))
                                    self._rules_img_cache[key] = img
                            except Exception:
                                img = None

                            if img is not None:
                                self.screen.blit(img, img_rect)
                                pygame.draw.rect(self.screen, (255, 255, 255), img_rect, 2)
                            else:
                                placeholder = pygame.Surface((img_rect.w, img_rect.h), pygame.SRCALPHA)
                                placeholder.fill((60, 60, 60, 160))
                                self.screen.blit(placeholder, img_rect)
                                pygame.draw.rect(self.screen, (200, 200, 200), img_rect, 2)
                                ph = body_f.render(f"[add: {img_name}]", True, (255, 255, 255))
                                self.screen.blit(ph, ph.get_rect(center=img_rect.center))

                            y += img_rect.h + 18
                            total_h += img_rect.h + 18
                        else:
                            y += 14
                            total_h += 14

                    self.screen.set_clip(None)

                    # clamp scroll
                    max_scroll = max(0, (total_h + 20) - inner.height)
                    rules_scroll = max(0, min(rules_scroll, max_scroll))

                    # simple scroll hint
                    hint = body_f.render("Scroll: mouse wheel / ↑↓", True, (200, 200, 200))
                    self.screen.blit(hint, (panel.left + 140, panel.bottom - 32))

                pygame.display.flip()
                await asyncio.sleep(0)
                self.clock.tick(30)
    def _draw_error_overlay(self, message: str) -> None:
        overlay = pygame.Surface((self.SCR_W, self.SCR_H), pygame.SRCALPHA)
        overlay.fill((0, 0, 0, 180))
        self.screen.blit(overlay, (0, 0))

        try:
            font_big = pygame.font.SysFont("bookmanoldstyle", 36, bold=True)
            font_small = pygame.font.SysFont("bookmanoldstyle", 24)
        except Exception:
            font_big = pygame.font.Font(None, 36)
            font_small = pygame.font.Font(None, 24)

        error_title = font_big.render("Error Loading Game", True, (255,50,50))
        error_msg   = font_small.render(message, True, (255,255,255))

        self.screen.blit(error_title, error_title.get_rect(center=(self.SCR_W//2, self.SCR_H//2 - 30)))
        self.screen.blit(error_msg, error_msg.get_rect(center=(self.SCR_W//2, self.SCR_H//2 + 20)))


    # =============================== main loop ======================= #
    async def run(self) -> None:
        # main loop: menu -> game -> (back to menu) until the window/tab closes
        while self.running:
            self.return_to_menu = False
            await self._show_start_menu()
            if not self.running:
                break

            action = self.settings.get("_action", "new")


            # match mode (Human vs Human / Human vs Computer)
            self.vs_ai = (self.settings.get("opponent", "Human") == "Computer")
            requested_side = str(self.settings.get("human_side", "Black"))
            if self.vs_ai:
                self.human_side = random.choice(["Black", "White"]) if requested_side == "Random" else requested_side
                self.ai_side = "White" if self.human_side == "Black" else "Black"
            else:
                self.human_side = "Black"
                self.ai_side = "White"
            self._configure_ai_difficulty(str(self.settings.get("ai_difficulty", "Medium")))
            if action == "new":
                # apply menu settings
                t = float(self.settings["timer"])
                rows, cols = self.settings["board_size"]
                special = int(self.settings.get("special_count", 5))
                transform_enabled = bool(self.settings.get("transform", False))
                self.untimed = t <= 0

                # reset per-match state (keep pygame alive)
                self._reset_match_state()

                # rebuild canonical 12x12 config
                self.cfg = GameConfig(
                    ROWS=rows,
                    COLS=cols,
                    SPECIAL_COUNT=special,
                    TRANSFORM_ENABLED=transform_enabled,
                )
                self._apply_responsive_layout(force=True)
                self.board = Board(self.cfg)
                self.board._generate_special_squares(special)

                # per-player clocks
                self.time_left = {"Black": t, "White": t}
                self._last_tick = pygame.time.get_ticks()
                if self.settings.get("placement_mode") == "Quick Balanced":
                    self._apply_quick_balanced_setup()

            elif action == "load":
                # _show_start_menu already loaded and reconstructed the game state.
                self.return_to_menu = False
                self.menu_active = False
                self._apply_responsive_layout(force=True)
                self._last_tick = pygame.time.get_ticks()

            # ---------------- game loop ----------------
            while self.running and not self.return_to_menu:
                self._update_clock()

                for ev in pygame.event.get():
                    if ev.type == pygame.QUIT:
                        self.running = False

                    elif ev.type == pygame.VIDEORESIZE:
                        # Keep the window resizable across desktop + web
                        try:
                            self.screen = pygame.display.set_mode((ev.w, ev.h), pygame.RESIZABLE)
                        except Exception:
                            self.screen = pygame.display.set_mode((ev.w, ev.h))
                        self.SCR_W, self.SCR_H = self.screen.get_size()

                    elif ev.type == pygame.MOUSEMOTION:
                        self.hover_cell = self._screen_to_cell(ev.pos)

                    elif ev.type == pygame.KEYDOWN:
                        # Audio unlock can be triggered by any user gesture
                        self._ensure_audio()

                        if ev.key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_SPACE):
                            if await self._confirm_defended_king_preview():
                                continue

                        if ev.key == pygame.K_ESCAPE and self.defended_king_preview_locked:
                            self._clear_defended_king_preview()
                            self._set_toast("Defended-King attack cancelled.")
                            continue

                        if ev.key == pygame.K_ESCAPE:
                            # Quick return to main menu (keeps pygame alive)
                            self._go_to_main_menu()
                        elif ev.key == pygame.K_u:
                            self._undo()
                        elif ev.key == pygame.K_s:
                            self._try_save_game("moves.txt")
                        elif ev.key == pygame.K_l:
                            self._try_load_saved_game("moves.txt")

                    elif ev.type == pygame.MOUSEBUTTONDOWN:
                        # Browser audio unlock: retry mixer init on first click.
                        self._ensure_audio()
                        await self._on_click(ev.pos)

                # AI step (if enabled)
                await self._maybe_ai_step()

                self._draw()
                self.clock.tick(60)
                await asyncio.sleep(0)

            # clean up any overlay state before showing the menu again
            self.menu_active = False
            self.menu_buttons = {}

        pygame.quit()



    def _show_endgame_menu(self, winner: str) -> None:
        self.menu_active = True
        self.menu_winner = winner
        # play victory sound once (optional; safe on web if audio is blocked)
        if not self._victory_played:
            self._victory_played = True
            try:
                if self.victory_sound:
                    self.victory_sound.play()
            except Exception:
                pass
        # freeze the board — don’t call pygame.quit() yet
        # build button rects in screen coords:
        cx, cy = self.SCR_W//2, self.SCR_H//2
        w, h   = 200, 50
        spacing = 20
        self.menu_buttons['Save'] = pygame.Rect(cx - w//2, cy,          w, h)
        self.menu_buttons['Quit'] = pygame.Rect(cx - w//2, cy + h + spacing , w, h)
        self.menu_buttons['Restart'] = pygame.Rect(cx - w//2, cy + 2 * (h + spacing), w, h)

    
    def _save_snapshot_dict(self) -> dict:
        settings = copy.deepcopy(self.settings)
        if isinstance(settings.get("board_size"), tuple):
            settings["board_size"] = list(settings["board_size"])

        undo_history: list[dict] = []
        for entry in self.move_history:
            if "snapshot" not in entry:
                continue
            undo_history.append({
                "snapshot": copy.deepcopy(entry["snapshot"]),
                "state": copy.deepcopy(entry.get("state", {})),
            })

        return {
            "format": "assalto_reale_snapshot",
            "version": 1,
            "board": self.board.to_dict(),
            "ui": {
                "time_left": {
                    "Black": float(self.time_left.get("Black", 0.0)),
                    "White": float(self.time_left.get("White", 0.0)),
                },
                "untimed": bool(self.untimed),
                "current_player": int(self.current_player),
                "moves_this_turn": int(self.moves_this_turn),
                "king_moved": bool(self.king_moved),
                "placing": bool(self.placing),
                "pieces_left": copy.deepcopy(self.pieces_left),
                "pieces_placed": copy.deepcopy(self.pieces_placed),
                "turn_sequence": list(self.turn_sequence),
                "turn_index": int(self.turn_index),
                "turn_pieces_count": int(self.turn_pieces_count),
                "turn_counter": int(self.turn_counter),
                "placement_history": copy.deepcopy(self.placement_history),
                "undo_history": undo_history,
                "settings": settings,
                "vs_ai": bool(self.vs_ai),
                "ai_side": self.ai_side,
                "human_side": self.human_side,
                "timer_index": int(self.timer_index),
                "opponent_index": int(self.opponent_index),
                "human_side_index": int(self.human_side_index),
                "ai_difficulty_index": int(self.ai_difficulty_index),
                "transform_index": int(self.transform_index),
                "placement_mode_index": int(self.placement_mode_index),
                "menu_winner": self.menu_winner,
            },
        }

    def _restore_snapshot_dict(self, data: dict) -> None:
        if data.get("format") != "assalto_reale_snapshot":
            raise ValueError("Unsupported save format")
        if int(data.get("version", 0)) != 1:
            raise ValueError(f"Unsupported save version: {data.get('version')}")

        ui = data.get("ui", {})
        self._reset_match_state()

        self.board = Board.from_dict(data["board"])
        self.cfg = self.board.cfg
        self._apply_responsive_layout(force=True)

        saved_settings = copy.deepcopy(ui.get("settings", {}))
        if isinstance(saved_settings.get("board_size"), list):
            saved_settings["board_size"] = tuple(saved_settings["board_size"])
        self.settings = saved_settings

        self.time_left = {
            "Black": float(ui.get("time_left", {}).get("Black", 0.0)),
            "White": float(ui.get("time_left", {}).get("White", 0.0)),
        }
        self.untimed = bool(ui.get("untimed", self.time_left["Black"] <= 0 and self.time_left["White"] <= 0))
        self.current_player = int(ui.get("current_player", 0))
        self.moves_this_turn = int(ui.get("moves_this_turn", 0))
        self.king_moved = bool(ui.get("king_moved", False))
        self.placing = bool(ui.get("placing", False))
        self.pieces_left = copy.deepcopy(ui.get("pieces_left", self.pieces_left))
        self.pieces_placed = copy.deepcopy(ui.get("pieces_placed", self.pieces_placed))
        self.turn_sequence = [int(v) for v in ui.get("turn_sequence", self.turn_sequence)]
        self.turn_index = int(ui.get("turn_index", 0))
        self.turn_pieces_count = int(ui.get("turn_pieces_count", 0))
        self.turn_counter = int(ui.get("turn_counter", 0))

        self.placement_history = [
            {"player": entry["player"], "type": entry["type"], "pos": tuple(entry["pos"])}
            for entry in ui.get("placement_history", [])
        ]
        self.move_history = [
            {
                "snapshot": copy.deepcopy(entry["snapshot"]),
                "state": copy.deepcopy(entry.get("state", {})),
            }
            for entry in ui.get("undo_history", [])
            if "snapshot" in entry
        ]

        self.vs_ai = bool(ui.get("vs_ai", False))
        self.ai_side = str(ui.get("ai_side", "White"))
        self.human_side = str(ui.get("human_side", "Black"))
        def clamp_index(value: object, options: list[object], fallback: int) -> int:
            try:
                idx = int(value)
            except Exception:
                idx = fallback
            return max(0, min(len(options) - 1, idx))

        self.timer_index = clamp_index(ui.get("timer_index", self.timer_index), self.timer_options, self.timer_index)
        self.opponent_index = clamp_index(ui.get("opponent_index", self.opponent_index), self.opponent_options, self.opponent_index)
        self.human_side_index = clamp_index(ui.get("human_side_index", self.human_side_index), self.human_side_options, self.human_side_index)
        self.ai_difficulty_index = clamp_index(ui.get("ai_difficulty_index", self.ai_difficulty_index), self.ai_difficulty_options, self.ai_difficulty_index)
        self.transform_index = clamp_index(ui.get("transform_index", self.transform_index), self.transform_options, self.transform_index)
        self.placement_mode_index = clamp_index(ui.get("placement_mode_index", self.placement_mode_index), self.placement_mode_options, self.placement_mode_index)
        self._configure_ai_difficulty(self.ai_difficulty_options[self.ai_difficulty_index])

        self.board.update_control()
        claim = self.board.territory_claim
        self.candidate_winner = claim.claimant if claim else None
        self.candidate_turn_index = claim.created_turn if claim else None
        self._ai_plan = []
        self._last_tick = pygame.time.get_ticks()
        self._clear_defended_king_preview()
        self.selected = None

        winner = ui.get("menu_winner")
        if winner:
            self._show_endgame_menu(str(winner))
        else:
            self.menu_active = False
            self.menu_winner = None
            self.menu_buttons = {}

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
            if "piece" not in m:
                lines.append(f"{i}. snapshot-backed undo entry")
                continue
            piece     = m["piece"]
            fr, to    = m["from"], m["to"]
            start_sq  = f"{chr(ord('A')+fr[1])}{self.cfg.ROWS-fr[0]}"
            end_sq    = f"{chr(ord('A')+to[1])}{self.cfg.ROWS-to[0]}"
            captured  = m["captured"]
            if isinstance(captured, dict) and "defense" in captured:
                cap_desc = " (defended King bounce; Defense Pawn sacrificed)"
            elif captured:
                cap_desc = f" captured {captured.type}"
            else:
                cap_desc = ""
            lines.append(f"{i}. {piece.player} {piece.type} {start_sq}→{end_sq}{cap_desc}")

        return "\n".join(lines)

    
    def _save_moves_to_file(self, filename: str = "moves.txt") -> None:
        """Persist the canonical engine snapshot in a Vercel/pygbag-safe way.

        We do an atomic write (temp + replace) so a partial write can’t corrupt
        an existing save if the browser tab is closed mid-write.
        """
        snapshot = self._save_snapshot_dict()
        tmp = f"{filename}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, ensure_ascii=False, sort_keys=True, indent=2)
        # atomic on POSIX; on Windows it's best-effort but still safer than direct writes
        os.replace(tmp, filename)

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
        """Charge only active human decision time."""
        now   = pygame.time.get_ticks()
        player = AssaltoRealeApp.players[self.current_player]
        ai_decision = self.vs_ai and player == self.ai_side
        if self.untimed or self.placing or self.menu_active or self.return_to_menu or ai_decision:
            self._last_tick = now
            return
        delta = (now - self._last_tick) / 1000.0   # to seconds
        self._last_tick = now
        self.time_left[player] = max(0.0, self.time_left[player] - delta)

        # flag victory if someone runs out
        if self.menu_active:
            return
        if self.time_left["Black"] == 0.0:
            self._show_endgame_menu("White")
        elif self.time_left["White"] == 0.0:
            self._show_endgame_menu("Black")

    def _handle_endgame_click(self, pos: Tuple[int,int]) -> None:
        x, y = pos
        if self.menu_buttons['Save'].collidepoint(x,y):
            self._try_save_game("moves.txt")
        elif self.menu_buttons['Quit'].collidepoint(x,y):
            self._go_to_main_menu()
        elif self.menu_buttons['Restart'].collidepoint(x,y):
            self.reset_game()
            self.menu_active = False
    


    # ============================ event handling ===================== #
    async def _on_click(self, pos: Tuple[int, int]) -> None:
        x, y = pos
        if self.menu_active:
            self._handle_endgame_click(pos)
            return

        ai_turn = self.vs_ai and (AssaltoRealeApp.players[self.current_player] == self.ai_side)
        if ai_turn:
            # While the AI is making its turn, ignore player clicks (prevents desync).
            # Keep only the emergency exits.
            if self._within(x, y, self.RESET_X, self.RESET_Y, self.RESET_W, self.RESET_H):
                self._clear_defended_king_preview()
                self.reset_game()
                return
            if self._within(x, y, self.QUIT_X, self.QUIT_Y, self.QUIT_W, self.QUIT_H):
                self._clear_defended_king_preview()
                self._go_to_main_menu()
                return
            return

        # --- buttons ---------------------------------------------------
        if self._within(x, y, self.UNDO_X, self.UNDO_Y, self.UNDO_W, self.UNDO_H):
            self._clear_defended_king_preview()
            self._undo()
            return
        if not self.placing and self._within(x, y, self.BUTTON_X, self.BUTTON_Y, self.BUTTON_W, self.BUTTON_H):
            self._clear_defended_king_preview()
            self._end_turn()
            return
        if self._within(x, y, self.RESET_X, self.RESET_Y, self.RESET_W, self.RESET_H):
            self._clear_defended_king_preview()
            self.reset_game()
            return
        if self._within(x, y, self.QUIT_X, self.QUIT_Y, self.QUIT_W, self.QUIT_H):
            self._clear_defended_king_preview()
            self._go_to_main_menu()
            return
            # in _on_click, after your other button‐checks:
        if self._within(x, y, self.SAVE_X, self.SAVE_Y, self.SAVE_W, self.SAVE_H):
            self._clear_defended_king_preview()
            self._try_save_game("moves.txt")
            return
        if self._within(x, y, self.LOAD_X, self.LOAD_Y, self.LOAD_W, self.LOAD_H):
            self._clear_defended_king_preview()
            self._try_load_saved_game("moves.txt")
            return
    


        # --- board interaction ----------------------------------------
        # Map screen pixels -> board cell, accounting for responsive layout offset
        if not self.board_grid_rect.collidepoint(x, y):
            if self.defended_king_preview_locked:
                self._clear_defended_king_preview()
                self._set_toast("Defended-King attack cancelled.")
            return
        col = (x - self.board_grid_rect.x) // self.cfg.SQ_SIZE
        row = (y - self.board_grid_rect.y) // self.cfg.SQ_SIZE
        if not (0 <= row < self.cfg.ROWS and 0 <= col < self.cfg.COLS):
            return

        if self.placing:
            self._handle_placement_click((row, col))
        else:
            await self._handle_move_click((row, col))

    def _load_moves_from_file(self, filename: str = "moves.txt") -> None:
        with open(filename, "r", encoding="utf-8") as f:
            payload = f.read()
        stripped = payload.lstrip()
        if stripped.startswith("{"):
            data = json.loads(payload)
            if data.get("format") == "assalto_reale_snapshot":
                self._restore_snapshot_dict(data)
                return

        # 1) parse everything
        settings, special_sqs, transform_sqs, placements, moves = self._parse_game_file(filename)

        # wipe any in-memory state from a previous match (prevents weird carry-over after Load)
        self._reset_match_state()
        self.moves_this_turn = 0
        self.king_moved = False

        # 2) restore the turn counter before anything else
        self.turn_counter = int(settings.get("turn_counter", 0))

        # 3) apply board‐size from settings
        bs = settings.get("board_size", f"{self.cfg.ROWS}x{self.cfg.COLS}")
        rows, cols = [int(x) for x in bs.split("x")]
        self.cfg = GameConfig(ROWS=rows, COLS=cols, SPECIAL_COUNT=self.cfg.SPECIAL_COUNT)
        self._apply_responsive_layout(force=True)
        self.board = Board(self.cfg)

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
                   "moves":            self.moves_this_turn,
                   "king_moved":       self.king_moved
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


    def _screen_to_cell(self, pos: Tuple[int, int]) -> Optional[Vec2]:
        """Map a screen (pixel) position to a board cell (r,c), or None."""
        if not hasattr(self, "board_grid_rect"):
            return None
        rect = self.board_grid_rect
        mx, my = pos
        if not rect.collidepoint(mx, my):
            return None
        c = int((mx - rect.x) // self.cfg.SQ_SIZE)
        r = int((my - rect.y) // self.cfg.SQ_SIZE)
        if 0 <= r < self.cfg.ROWS and 0 <= c < self.cfg.COLS:
            return (r, c)
        return None

    def _clear_defended_king_preview(self) -> None:
        self.defended_king_preview = None
        self.defended_king_preview_start = None
        self.defended_king_preview_target = None
        self.defended_king_preview_locked = False

    def _defended_king_preview_for(self, start: Vec2, end: Vec2) -> Optional[DefendedKingPreview]:
        if not (self.board.is_in_bounds(start) and self.board.is_in_bounds(end)):
            return None
        piece = self.board[start[0]][start[1]]
        if piece is None or piece.player != AssaltoRealeApp.players[self.current_player]:
            return None
        action = self.board.build_action(
            start,
            end,
            moves_this_turn=self.moves_this_turn,
            king_moved=self.king_moved,
        )
        if action.error is not None:
            return None
        return action.defended_king

    def _set_defended_king_preview(
        self,
        start: Vec2,
        target: Vec2,
        preview: DefendedKingPreview,
        *,
        locked: bool,
    ) -> None:
        self.defended_king_preview = preview
        self.defended_king_preview_start = start
        self.defended_king_preview_target = target
        self.defended_king_preview_locked = locked

    def _current_defended_king_preview(self) -> Optional[DefendedKingPreview]:
        if self.defended_king_preview_locked:
            return self.defended_king_preview

        if self.selected and self.hover_cell:
            preview = self._defended_king_preview_for(self.selected, self.hover_cell)
            if preview is not None:
                self._set_defended_king_preview(self.selected, self.hover_cell, preview, locked=False)
                return preview

        if self.defended_king_preview is not None:
            self._clear_defended_king_preview()
        return None

    async def _confirm_defended_king_preview(self) -> bool:
        if not (
            self.defended_king_preview_locked
            and self.defended_king_preview_start is not None
            and self.defended_king_preview_target is not None
        ):
            return False

        start = self.defended_king_preview_start
        target = self.defended_king_preview_target
        self._clear_defended_king_preview()
        await self._attempt_move(start, target)
        return True

    def _defended_king_toast(self, preview: DefendedKingPreview) -> str:
        landing = self.board.square_name(preview.landing_position, self.cfg.ROWS)
        return f"Defended King: lands on {landing}. Click again to confirm."

    def _ensure_audio(self) -> None:
        """Best-effort audio unlock (needed on web due to autoplay restrictions).

        Call this ONLY as a direct consequence of a user gesture (mouse/key event).
        """
        if self._audio_unlocked or self._audio_unlock_failed:
            return

        # Avoid hammering init every frame if something is genuinely broken.
        now = pygame.time.get_ticks()
        if now - self._audio_last_unlock_attempt_ms < 750:
            return
        self._audio_last_unlock_attempt_ms = now

        try:
            # 1) Try enabling audio in the AssetLoader (may retry mixer.init internally).
            if hasattr(self, "assets") and hasattr(self.assets, "try_enable_audio"):
                self.assets.try_enable_audio()

            # 2) If mixer isn't up, try to start it now.
            if not pygame.mixer.get_init():
                pygame.mixer.init()

            # If the initial AssetLoader was created before the first user gesture,
            # it may have fallen back to no-op sounds. Recreate it once audio is available.
            try:
                if hasattr(self, "assets") and getattr(self.assets, "_audio_ok", True) is False:
                    self.assets = AssetLoader(self.cfg)
            except Exception:
                pass

            # 3) Load victory sound after mixer is alive.
            if self.victory_sound is None and pygame.mixer.get_init():
                # Prefer OGG/WAV on web; MP3 support is inconsistent.
                candidates = [
                    "victory.ogg", "victory.wav",
                    "Victory.ogg", "Victory.wav",
                    "Victory.mp3", "victory.mp3",
                ]
                for fn in candidates:
                    try:
                        path = os.path.join(self.cfg.ASSETS_DIR, fn)
                        if os.path.exists(path):
                            self.victory_sound = pygame.mixer.Sound(path)
                            break
                    except Exception:
                        continue

            self._audio_unlocked = True
        except Exception:
            # On the web, this commonly fails before the first click; we will retry later.
            self._audio_unlock_failed = False


    # ======================= UX helpers (toast) ======================= #
    def _set_toast(self, message: str, *, duration_ms: int = 2500) -> None:
        self.toast_message = message
        self.toast_until_ms = pygame.time.get_ticks() + int(duration_ms)

    def _draw_toast(self) -> None:
        if not self.toast_message:
            return
        if pygame.time.get_ticks() > self.toast_until_ms:
            self.toast_message = None
            return

        msg = self.toast_message
        # Use a web-safe font
        try:
            f = pygame.font.SysFont("bookmanoldstyle", max(18, int(self.cfg.SQ_SIZE * 0.32)))
        except Exception:
            f = pygame.font.Font(None, max(18, int(self.cfg.SQ_SIZE * 0.32)))

        pad_x, pad_y = 14, 10
        surf = f.render(msg, True, (255, 255, 255))
        w = surf.get_width() + 2 * pad_x
        h = surf.get_height() + 2 * pad_y

        x = (self.SCR_W - w) // 2
        y = self.SCR_H - h - 20

        box = pygame.Surface((w, h), pygame.SRCALPHA)
        # Rounded fill to avoid visible square corners
        box.fill((0, 0, 0, 0))
        pygame.draw.rect(box, (0, 0, 0, 170), (0, 0, w, h), border_radius=10)
        pygame.draw.rect(box, (255, 255, 255), (0, 0, w, h), 2, border_radius=10)
        box.blit(surf, (pad_x, pad_y))
        self.screen.blit(box, (x, y))

    # ======================= Save / Load helpers ====================== #
    def _has_saved_game(self, filename: str = "moves.txt") -> bool:
        try:
            return os.path.exists(filename) and os.path.getsize(filename) > 0
        except Exception:
            return False

    def _try_load_saved_game(self, filename: str = "moves.txt", *, show_toast: bool = True) -> bool:
        if not self._has_saved_game(filename):
            if show_toast:
                self._set_toast("No saved game found.")
            return False
        try:
            self._load_moves_from_file(filename)
            if show_toast:
                self._set_toast("Game loaded.")
            return True
        except Exception as e:
            if show_toast:
                self._set_toast(f"Load failed: {e}")
            return False

    def _try_save_game(self, filename: str = "moves.txt") -> bool:
        try:
            self._save_moves_to_file(filename)
            self._set_toast("Game saved.")
            return True
        except Exception as e:
            self._set_toast(f"Save failed: {e}")
            return False

    def _go_to_main_menu(self) -> None:
        # leave pygame running; just break the current game loop
        self.return_to_menu = True
        self.menu_active = False
        self.selected = None
        self._clear_defended_king_preview()


    # =========================== placement phase ===================== #
    def _set_placement_progress_from_count(self, placed_count: int) -> None:
        total = sum(step.count for step in Board.PLACEMENT_SCHEDULE)
        if placed_count >= total:
            self.placing = False
            self.current_player = 0
            self.turn_index = len(self.turn_sequence) - 1
            self.turn_pieces_count = 0
            return

        remaining = max(0, placed_count)
        for index, step in enumerate(Board.PLACEMENT_SCHEDULE):
            if remaining < step.count:
                self.placing = True
                self.current_player = AssaltoRealeApp.players.index(step.player)
                self.turn_index = index
                self.turn_pieces_count = remaining
                return
            remaining -= step.count

        self.placing = False
        self.current_player = 0
        self.turn_index = len(self.turn_sequence) - 1
        self.turn_pieces_count = 0

    def _undo_placement(self) -> bool:
        if not self.placement_history:
            return False

        last = self.placement_history.pop()
        r, c = last["pos"]
        if self.board.is_in_bounds((r, c)):
            self.board[r][c] = None

        player = last["player"]
        ptype = last["type"]
        self.pieces_left[player][ptype] += 1
        self.pieces_placed[player] = max(0, self.pieces_placed[player] - 1)
        self._set_placement_progress_from_count(len(self.placement_history))
        self.selected = None
        self._set_toast(f"Undid {player} {ptype} placement.")
        return True

    def _handle_placement_click(self, pos: Vec2) -> None:
        r, c = pos
        if self.board[r][c] is not None:
            return
        player = AssaltoRealeApp.players[self.current_player]
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
        self._set_placement_progress_from_count(len(self.placement_history))

    # =========================== move phase ========================== #
    async def _handle_move_click(self, pos: Vec2) -> None:
        r, c = pos
        if self.defended_king_preview_locked:
            if (
                self.defended_king_preview_start == self.selected
                and self.defended_king_preview_target == pos
            ):
                await self._confirm_defended_king_preview()
                return
            self._clear_defended_king_preview()
            self._set_toast("Defended-King attack cancelled.")
            return

        if self.selected:
            preview = self._defended_king_preview_for(self.selected, pos)
            if preview is not None:
                self._set_defended_king_preview(self.selected, pos, preview, locked=True)
                self._set_toast(self._defended_king_toast(preview), duration_ms=4500)
                return
            await self._attempt_move(self.selected, pos)
        else:
            piece = self.board[r][c]
            if piece and piece.player == AssaltoRealeApp.players[self.current_player]:
                self._clear_defended_king_preview()
                self.selected = pos

    async def _attempt_move(
        self,
        start: Vec2,
        end: Vec2,
        *,
        selected_defender: Optional[Vec2] = None,
    ) -> None:
        piece = self.board[start[0]][start[1]]
        self.last_move = (start, end)
        if not piece:
            self.selected = None
            self._clear_defended_king_preview()
            return
        action = self.board.build_action(
            start,
            end,
            moves_this_turn=self.moves_this_turn,
            king_moved=self.king_moved,
            selected_defender=selected_defender,
        )
        if action.error is not None:
            self._set_toast(action.error)
            self.selected = None
            self._clear_defended_king_preview()
            return

        if action.defended_king is not None and action.selected_defender is None:
            self._set_defended_king_preview(start, end, action.defended_king, locked=True)
            chosen_defender = await self._choose_defender_for_defended_king(start, end, action.defended_king)
            self._clear_defended_king_preview()
            if chosen_defender is None:
                self._set_toast("Defended-King attack cancelled.")
                self.selected = start
                return
            action = self.board.build_action(
                start,
                end,
                moves_this_turn=self.moves_this_turn,
                king_moved=self.king_moved,
                selected_defender=chosen_defender,
            )
            if action.error is not None:
                self._set_toast(action.error)
                self.selected = None
                self._clear_defended_king_preview()
                return

        previous_board = self.board.snapshot()
        captured = copy.deepcopy(self.board[end[0]][end[1]])
        history_end = end

        if action.defended_king is not None:
            preview = action.defended_king
            defender = action.selected_defender
            if defender is None:
                defenders = self.board.adjacent_defenders_for_king(end, captured.player if captured else "")
                defender = defenders[0] if defenders else None
            def_piece = copy.deepcopy(self.board[defender[0]][defender[1]]) if defender else None
            history_end = preview.landing_position
            captured_for_history = {"defense": (def_piece, defender)} if def_piece and defender else None
            self._record_move(start, history_end, piece, captured_for_history, snapshot=previous_board)

            await self._animate_king_attack(end)
            self.assets.shield_sound.play()

            # Animate the previewed bounce, then restore before the engine applies the transition.
            visual_snapshot = self.board.snapshot()
            await self._animate_bounce(self.board.bounce_attack_pawn_path(start, end), piece)
            self.board.restore(visual_snapshot)
        else:
            self._record_move(start, end, piece, captured, snapshot=previous_board)
            if captured and captured.type == "King":
                await self._animate_king_attack(end)
            else:
                self.board[end[0]][end[1]] = None
                self.board[start[0]][start[1]] = None
                dur = int(self.ai_move_anim_ms) if self.vs_ai and piece.player == self.ai_side else 200
                await self._animate_slide(start, end, piece, duration_ms=dur)
                self.board.restore(previous_board)

        result = self.board.apply_action(
            action,
            moves_this_turn=self.moves_this_turn,
            king_moved=self.king_moved,
        )
        if result.error is not None:
            self.board.restore(previous_board)
            if self.move_history:
                self.move_history.pop()
            self._set_toast(result.error)
            self.selected = None
            self._clear_defended_king_preview()
            return

        if action.capture:
            self.assets.capture_sound.play()
        else:
            self.assets.move_sound.play()
        if piece.type == "ConquestPawn" and history_end in self.board.special_squares:
            self._flash_effects[history_end] = pygame.time.get_ticks()

        if result.victory is not None:
            self.selected = None
            self._clear_defended_king_preview()
            self._show_endgame_menu(result.victory.winner)
            return

        transform_pending = any(ev.kind == "transform_available" for ev in result.events)
        if not result.ends_turn:
            self.moves_this_turn = result.next_moves_this_turn
            self.king_moved = result.next_king_moved
        else:
            self._switch_player()
        self.selected = None
        self._clear_defended_king_preview()

        if transform_pending:
            if self.vs_ai and piece.player == self.ai_side:
                self._ai_auto_transform(history_end, self.board[history_end[0]][history_end[1]])
            else:
                landed = self.board[history_end[0]][history_end[1]]
                if landed is not None:
                    await self._prompt_transformation(history_end, landed)
            if not result.ends_turn:
                self._switch_player()

    async def _choose_defender_for_defended_king(
        self,
        start: Vec2,
        end: Vec2,
        preview: DefendedKingPreview,
    ) -> Optional[Vec2]:
        king = self.board[end[0]][end[1]]
        if king is None:
            return None

        defenders = list(self.board.adjacent_defenders_for_king(end, king.player))
        if not defenders:
            return None
        if len(defenders) == 1:
            return defenders[0]

        if self.vs_ai and king.player == self.ai_side:
            return self._ai_choose_defender_for_bounce(
                self.board,
                start,
                end,
                king.player,
                defenders,
                moves_this_turn=self.moves_this_turn,
                king_moved=self.king_moved,
            )

        return await self._prompt_defender_selection(preview, defenders, king.player)

    async def _prompt_defender_selection(
        self,
        preview: DefendedKingPreview,
        defenders: List[Vec2],
        defender_player: str,
    ) -> Optional[Vec2]:
        choosing = True
        cancel_rect: Optional[pygame.Rect] = None

        while choosing and self.running:
            for ev in pygame.event.get():
                if ev.type == pygame.QUIT:
                    self.running = False
                    return None
                if ev.type == pygame.VIDEORESIZE:
                    try:
                        self.screen = pygame.display.set_mode((ev.w, ev.h), pygame.RESIZABLE)
                    except Exception:
                        self.screen = pygame.display.set_mode((ev.w, ev.h))
                    self._apply_responsive_layout(force=True)
                elif ev.type == pygame.KEYDOWN:
                    self._ensure_audio()
                    if ev.key == pygame.K_ESCAPE:
                        return None
                    if ev.key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_SPACE):
                        return defenders[0]
                elif ev.type == pygame.MOUSEBUTTONDOWN:
                    self._ensure_audio()
                    if cancel_rect is not None and cancel_rect.collidepoint(ev.pos):
                        return None
                    cell = self._screen_to_cell(ev.pos)
                    if cell in defenders:
                        return cell

            self._draw()

            overlay = pygame.Surface((self.SCR_W, self.SCR_H), pygame.SRCALPHA)
            overlay.fill((0, 0, 0, 90))
            self.screen.blit(overlay, (0, 0))

            sq = self.cfg.SQ_SIZE
            for idx, (r, c) in enumerate(defenders, start=1):
                rect = pygame.Rect(
                    self.board_grid_rect.x + c * sq,
                    self.board_grid_rect.y + r * sq,
                    sq,
                    sq,
                )
                pygame.draw.rect(self.screen, (255, 255, 255), rect.inflate(-6, -6), 4, border_radius=6)
                pygame.draw.circle(self.screen, (33, 47, 72), rect.center, max(10, sq // 5), 0)
                label = self.font.render(str(idx), True, (255, 255, 255))
                self.screen.blit(label, label.get_rect(center=rect.center))

            landing = self.board.square_name(preview.landing_position, self.cfg.ROWS)
            lines = [
                f"{defender_player}: choose Defense Pawn to sacrifice",
                f"Attack Pawn will land on {landing}. The attacker's turn ends.",
                "Click a numbered defender, press Enter for the first, or Esc to cancel.",
            ]
            panel_font = pygame.font.Font(None, max(18, int(self.cfg.SQ_SIZE * 0.34)))
            title_font = pygame.font.Font(None, max(22, int(self.cfg.SQ_SIZE * 0.44)))
            pad = 14
            text_surfs = [title_font.render(lines[0], True, (255, 255, 255))]
            text_surfs.extend(panel_font.render(line, True, (230, 230, 230)) for line in lines[1:])
            panel_w = min(self.SCR_W - 24, max(s.get_width() for s in text_surfs) + 2 * pad)
            panel_h = sum(s.get_height() for s in text_surfs) + pad * 2 + 30
            panel_x = max(12, min(self.SCR_W - panel_w - 12, self.board_grid_rect.centerx - panel_w // 2))
            panel_y = max(12, min(self.SCR_H - panel_h - 12, self.board_grid_rect.bottom + 12))
            if panel_y + panel_h > self.SCR_H - 12:
                panel_y = max(12, self.board_grid_rect.y + 12)
            panel = pygame.Rect(panel_x, panel_y, panel_w, panel_h)
            pygame.draw.rect(self.screen, (24, 27, 32), panel, border_radius=8)
            pygame.draw.rect(self.screen, (220, 190, 110), panel, 2, border_radius=8)

            y = panel_y + pad
            for surf in text_surfs:
                self.screen.blit(surf, (panel_x + pad, y))
                y += surf.get_height() + 6

            cancel_rect = pygame.Rect(panel.right - 88, panel.bottom - 34, 74, 24)
            pygame.draw.rect(self.screen, (78, 82, 92), cancel_rect, border_radius=6)
            pygame.draw.rect(self.screen, (210, 210, 210), cancel_rect, 1, border_radius=6)
            cancel = panel_font.render("Cancel", True, (255, 255, 255))
            self.screen.blit(cancel, cancel.get_rect(center=cancel_rect.center))

            pygame.display.flip()
            self.clock.tick(60)
            await asyncio.sleep(0)

        return None

    def _ai_choose_defender_for_bounce(
        self,
        board: Board,
        start: Vec2,
        end: Vec2,
        defender_player: str,
        defenders: List[Vec2],
        *,
        moves_this_turn: int,
        king_moved: bool,
    ) -> Optional[Vec2]:
        best = defenders[0] if defenders else None
        best_score = -1e18

        for defender in defenders:
            candidate_board: Board = copy.deepcopy(board)
            action = candidate_board.build_action(
                start,
                end,
                moves_this_turn=moves_this_turn,
                king_moved=king_moved,
                selected_defender=defender,
            )
            if action.error is not None:
                continue
            result = candidate_board.apply_action(
                action,
                moves_this_turn=moves_this_turn,
                king_moved=king_moved,
            )
            if result.error is not None:
                continue

            score = self._ai_eval_position(candidate_board, defender_player)
            if result.victory is not None:
                score += 1e6 if result.victory.winner == defender_player else -1e6
            if score > best_score:
                best_score = score
                best = defender

        return best

    # ============================= bookkeeping ======================= #
    def _switch_player(self) -> None:
        self._clear_defended_king_preview()
        self.current_player = 1 - self.current_player
        self.turn_index = min(self.turn_index + 1,
                              len(self.turn_sequence) - 1)
        self.turn_pieces_count = 0
        self.moves_this_turn = 0
        self.king_moved = False

        self._last_tick = pygame.time.get_ticks()


        # reset any queued AI plan when turn switches
        self._ai_plan = []
        # --- turn counter / pending‑win logic -----------------------
        self.turn_counter += 1
        if self.cfg.TRANSFORM_ENABLED and self.turn_counter >= self.cfg.TRANSFORM_ROUND * 2 and not self.board.transform_squares:
            self.board._generate_transform_square()
        territory_win = self.board.refresh_territory_claim(turn_counter=self.turn_counter)
        self._check_special_squares()
        if territory_win is not None:
            self._show_endgame_menu(territory_win.winner)



        # If AI is to play next, give a small pacing delay before the first action
        if self.vs_ai and AssaltoRealeApp.players[self.current_player] == self.ai_side:
            self._ai_next_tick = pygame.time.get_ticks() + int(self.ai_delay_ms_move)
    def _end_turn(self) -> None:
        self._clear_defended_king_preview()
        self._switch_player()

    # ---------------------- move history (undo) ---------------------- #
    def _record_move(
        self,
        start: Vec2,
        end: Vec2,
        piece: Piece,
        captured: Optional[Piece],
        *,
        snapshot: Optional[dict] = None,
    ) -> None:
        entry = {
            "from": start,
            "to": end,
            "piece": copy.deepcopy(piece),
            "captured": captured,
            "transform_square": (next(iter(self.board.transform_squares))
                                 if self.board.transform_squares else None),
            "state": {
                "current_player": self.current_player,
                "moves": self.moves_this_turn,
                "king_moved": self.king_moved
            },
            "special_control": {
                "Black": self.board.controlled_squares["Black"].copy(),
                "White": self.board.controlled_squares["White"].copy()
            },
            "control": {
                "Black": self.board.controlled_squares["Black"].copy(),
                "White": self.board.controlled_squares["White"].copy()
            }


        }
        if snapshot is not None:
            entry["snapshot"] = copy.deepcopy(snapshot)
        self.move_history.append(entry)

    def _undo(self) -> None:          # <-- or  undo_move()  in main.py
        self._clear_defended_king_preview()
        if self.placing or (not self.move_history and self.placement_history):
            if self._undo_placement():
                return
        if not self.move_history:     # (history is called  move_history )
            return

        last = self.move_history.pop()
        if "snapshot" in last:
            self.board.restore(last["snapshot"])
            self.current_player = last["state"]["current_player"]
            self.moves_this_turn = last["state"]["moves"]
            self.king_moved = last["state"].get("king_moved", False)
            self.selected = None
            return

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
            # This was a defended-King bounce: bring the Defense Pawn back
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
        self.king_moved = last["state"].get("king_moved", False)
        self.selected = None

        if "control" in last:
            self.board.controlled_squares["Black"] = last["control"]["Black"].copy()
            self.board.controlled_squares["White"] = last["control"]["White"].copy()

        # restore transform square position
        self.board.transform_squares.clear()
        tsq = last.get("transform_square")
        if tsq is not None:
            self.board.transform_squares.add(tsq)



    # ============================== draw ============================= #

    # ------------------------------------------------------------------ #
    # King danger indicator (UI-only: does not change rules)

    def _find_king_pos(self, player: str) -> Optional[Vec2]:
        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                p = self.board[r][c]
                if p and p.type == "King" and p.player == player:
                    return (r, c)
        return None

    def _king_threat_state(self, player: str) -> Optional[str]:
        """Return None | "defended" | "exposed" depending on whether the player's King
        can be captured by the opponent in a single move (assuming it is the opponent's first move of the turn).
        """
        king_pos = self._find_king_pos(player)
        if king_pos is None:
            return None
        kr, kc = king_pos
        opp = "White" if player == "Black" else "Black"

        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                p = self.board[r][c]
                if not p or p.player != opp:
                    continue
                if p.type != "AttackPawn":
                    continue
                try:
                    if p.valid_move(self.board, (r, c), king_pos, 0):
                        defender = self.board.get_defense_adjacent_to_king(kr, kc, player)
                        return "defended" if defender else "exposed"
                except Exception:
                    continue
        return None

    def _draw_king_threat_pulse(self) -> None:
        """Pulse the current player's King if it is in immediate capture range."""
        player = AssaltoRealeApp.players[self.current_player]
        state = self._king_threat_state(player)
        if state is None:
            return
        king_pos = self._find_king_pos(player)
        if king_pos is None:
            return

        r, c = king_pos
        sq = self.cfg.SQ_SIZE
        center = (c * sq + sq // 2, r * sq + sq // 2)

        t = pygame.time.get_ticks() / 1000.0
        pulse = (math.sin(t * 5.0) + 1.0) * 0.5
        base_r = int(sq * 0.28)
        rad = int(base_r + pulse * sq * 0.10)
        alpha = int(80 + pulse * 120)

        if state == "exposed":
            col = (220, 70, 50)   # red-orange
        else:
            col = (220, 170, 60)  # amber (defended, but still costly)

        # two rings for readability on any tile color
        pygame.draw.circle(self.board_surface, (*col, alpha), center, rad, width=4)
        pygame.draw.circle(self.board_surface, (*col, alpha // 2), center, rad + 8, width=2)

    def _draw_king_threat_icon(self, rect: "pygame.Rect", state: str) -> None:
        """Small warning icon drawn on the HUD specials meter."""
        sq = self.cfg.SQ_SIZE
        s = max(16, int(sq * 0.42))
        cx = rect.right - (s // 2) - 10
        cy = rect.y + (s // 2) + 8
        if state == "exposed":
            col = (220, 70, 50)
        else:
            col = (220, 170, 60)

        tri = [(cx, cy - s // 2), (cx + s // 2, cy + s // 2), (cx - s // 2, cy + s // 2)]
        pygame.draw.polygon(self.screen, col, tri)
        pygame.draw.polygon(self.screen, self.cfg.BLACK, tri, 2)
        f = pygame.font.Font(None, max(18, int(sq * 0.55)))
        ex = f.render("!", True, self.cfg.BLACK)
        self.screen.blit(ex, ex.get_rect(center=(cx, cy + 3)))

    def _board_cell_center(self, pos: Vec2) -> Tuple[int, int]:
        r, c = pos
        sq = self.cfg.SQ_SIZE
        return (c * sq + sq // 2, r * sq + sq // 2)

    def _draw_defended_king_preview_overlay(self, preview: DefendedKingPreview) -> None:
        sq = self.cfg.SQ_SIZE
        attack_col = (210, 54, 68)
        bounce_col = (48, 123, 166)
        landing_col = (248, 216, 126)
        defender_col = (33, 47, 72)

        def center(pos: Vec2) -> Tuple[int, int]:
            return self._board_cell_center(pos)

        attack_points = [preview.attacker_origin, *preview.attack_path]
        if len(attack_points) >= 2:
            pygame.draw.lines(
                self.board_surface,
                attack_col,
                False,
                [center(pos) for pos in attack_points],
                max(3, sq // 12),
            )
        for pos in preview.attack_path:
            pygame.draw.circle(self.board_surface, attack_col, center(pos), max(5, sq // 8), 2)

        bounce_points = [preview.king_position, *preview.bounce_path]
        if len(bounce_points) >= 2:
            pygame.draw.lines(
                self.board_surface,
                bounce_col,
                False,
                [center(pos) for pos in bounce_points],
                max(3, sq // 10),
            )
        for pos in preview.bounce_path:
            pygame.draw.circle(self.board_surface, bounce_col, center(pos), max(4, sq // 9), 2)
            x, y = center(pos)
            pygame.draw.line(self.board_surface, bounce_col, (x - sq // 8, y), (x + sq // 8, y), 2)
            pygame.draw.line(self.board_surface, bounce_col, (x, y - sq // 8), (x, y + sq // 8), 2)

        landing_rect = pygame.Rect(
            preview.landing_position[1] * sq,
            preview.landing_position[0] * sq,
            sq,
            sq,
        )
        pygame.draw.rect(self.board_surface, landing_col, landing_rect.inflate(-6, -6), 4, border_radius=6)

        attacker = self.board[preview.attacker_origin[0]][preview.attacker_origin[1]]
        if attacker is not None:
            ghost = self.assets.piece_images[attacker.player][attacker.type].copy()
            ghost.set_alpha(115)
            self.board_surface.blit(ghost, ghost.get_rect(center=center(preview.landing_position)))

        king_rect = pygame.Rect(preview.king_position[1] * sq, preview.king_position[0] * sq, sq, sq)
        pygame.draw.rect(self.board_surface, attack_col, king_rect.inflate(-4, -4), 3, border_radius=8)

        for piece_id in preview.eligible_defender_ids:
            pos = self.board.position_for_piece_id(piece_id)
            if pos is None:
                continue
            rect = pygame.Rect(pos[1] * sq, pos[0] * sq, sq, sq)
            pygame.draw.rect(self.board_surface, defender_col, rect.inflate(-8, -8), 4, border_radius=8)
            cx, cy = center(pos)
            pygame.draw.line(self.board_surface, defender_col, (cx - sq // 5, cy), (cx, cy + sq // 5), 3)
            pygame.draw.line(self.board_surface, defender_col, (cx, cy + sq // 5), (cx + sq // 4, cy - sq // 5), 3)

    def _draw_defended_king_callout(self, preview: DefendedKingPreview, *, locked: bool) -> None:
        if not hasattr(self, "hud_rect"):
            return

        landing = self.board.square_name(preview.landing_position, self.cfg.ROWS)
        lines = [
            "Defended King",
            "Defense Pawn will be sacrificed",
            f"Attack Pawn lands on {landing}",
            f"Cost {preview.action_cost} AP; turn ends",
        ]
        if len(preview.eligible_defender_ids) > 1:
            lines.append("Defender chooses the sacrifice")
        if preview.triggers_transform:
            lines.append(f"Landing on {landing} triggers Transform")
        lines.append("Click again / Enter to confirm" if locked else "Click target once to lock preview")

        title_font = pygame.font.Font(None, max(20, int(self.cfg.SQ_SIZE * 0.42)))
        body_font = pygame.font.Font(None, max(16, int(self.cfg.SQ_SIZE * 0.31)))
        rendered = [title_font.render(lines[0], True, (255, 255, 255))]
        rendered.extend(body_font.render(line, True, (235, 235, 235)) for line in lines[1:])

        pad = 12
        w = min(max(220, self.hud_rect.w - 20), max(s.get_width() for s in rendered) + 2 * pad)
        h = sum(s.get_height() for s in rendered) + 2 * pad + (len(rendered) - 1) * 4
        x = self.hud_rect.left + 10
        y = self.hud_rect.bottom - h - 10
        if y < self.hud_rect.top + 10:
            y = self.hud_rect.top + 10

        panel = pygame.Rect(x, y, w, h)
        pygame.draw.rect(self.screen, (24, 27, 32), panel, border_radius=8)
        pygame.draw.rect(self.screen, (220, 190, 110), panel, 2, border_radius=8)

        ty = y + pad
        for surf in rendered:
            self.screen.blit(surf, (x + pad, ty))
            ty += surf.get_height() + 4


    def _draw(self) -> None:
        # Keep layout in sync with the current window size
        self._apply_responsive_layout()

        # Selection OR hover preview
        sel: Optional[Vec2] = self.selected
        valid: List[Vec2] = []

        if self.selected:
            piece = self.board[self.selected[0]][self.selected[1]]
            if piece:
                valid = self._compute_valid_moves(piece, self.selected)

        # Hover preview (only when nothing is selected)
        elif self.hover_cell and not self.placing and not self.menu_active:
            # If vs AI, only preview for the human side
            cur_side = AssaltoRealeApp.players[self.current_player]
            if (not self.vs_ai) or (cur_side == self.human_side):
                r, c = self.hover_cell
                piece = self.board[r][c]
                if piece and piece.player == cur_side:
                    sel = self.hover_cell
                    valid = self._compute_valid_moves(piece, self.hover_cell)

        defended_preview = None if self.placing or self.menu_active else self._current_defended_king_preview()

        # Draw board onto offscreen surface (origin at 0,0)
        draw_board(self.board, self.board_surface, self.font, sel, valid, cfg=self.cfg, assets=self.assets)

        if defended_preview is not None:
            self._draw_defended_king_preview_overlay(defended_preview)

        # Last-move highlight (board coords)
        if self.last_move:
            fr, to = self.last_move
            for r, c in [fr, to]:
                pygame.draw.rect(
                    self.board_surface,
                    self.cfg.GRAY,
                    (c * self.cfg.SQ_SIZE, r * self.cfg.SQ_SIZE, self.cfg.SQ_SIZE, self.cfg.SQ_SIZE),
                    3,
                )

        # overlays that are naturally board-space
        self._draw_placement_overlay()
        self._draw_square_flashes()
        self._draw_king_threat_pulse()

        # Compose: board + HUD
        self.screen.fill(self.cfg.GRAY)
        self.screen.blit(self.board_surface, self.board_surf_rect.topleft)
        self._draw_hud()
        if defended_preview is not None:
            self._draw_defended_king_callout(
                defended_preview,
                locked=self.defended_king_preview_locked,
            )
        if self.menu_active:
            self._draw_endgame_menu()

        # lightweight notifications
        self._draw_toast()

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
            label = "MAIN MENU" if name == "Quit" else name
            txt_surf = self.font.render(label, True, self.cfg.WHITE)
            self.screen.blit(txt_surf, txt_surf.get_rect(center=rect.center))


    
    async def _prompt_transformation(self, pos: Vec2, piece: Piece) -> None:
        # Web-safe transformation prompt:
        # draw the full scene (board + HUD) and overlay a choice panel.
        options = ["AttackPawn", "DefensePawn", "ConquestPawn"]
        selecting = True

        while selecting and self.running:
            # Keep layout stable (and responsive if the user resized)
            self._apply_responsive_layout()

            # Prefer centering on the board area
            sw, sh = self.screen.get_size()
            center_x, center_y = sw // 2, sh // 2
            if hasattr(self, "board_grid_rect"):
                center_x, center_y = self.board_grid_rect.centerx, self.board_grid_rect.centery

            size = max(32, int(self.cfg.SQ_SIZE * 0.90))
            spacing = max(10, int(size * 0.30))
            total_w = len(options) * size + (len(options) - 1) * spacing

            pad = max(10, int(size * 0.22))
            panel_w = total_w + 2 * pad
            panel_h = size + 2 * pad

            panel_x = int(center_x - panel_w // 2)
            panel_y = int(center_y - panel_h // 2)

            # Clamp on-screen
            panel_x = max(10, min(panel_x, sw - 10 - panel_w))
            panel_y = max(10, min(panel_y, sh - 10 - panel_h))

            # Build icons + click rects
            rects = []
            icons = []
            for i, opt in enumerate(options):
                img = self.assets.piece_images[piece.player][opt]
                img = pygame.transform.scale(img, (size, size))
                x = panel_x + pad + i * (size + spacing)
                y = panel_y + pad
                icons.append((img, (x, y)))
                rects.append(pygame.Rect(x, y, size, size))

            panel_color = self.cfg.WHITE if piece.player == "Black" else self.cfg.BLACK
            border_color = (255, 255, 255) if panel_color == (0, 0, 0) else (0, 0, 0)

            # Events
            for ev in pygame.event.get():
                if ev.type == pygame.QUIT:
                    self.running = False
                    return
                if ev.type == pygame.MOUSEBUTTONDOWN:
                    mx, my = ev.pos
                    for idx, r in enumerate(rects):
                        if r.collidepoint(mx, my):
                            new_type = options[idx]
                            result = self.board.transform_piece(pos, new_type)
                            if result.error is not None:
                                self._set_toast(result.error)
                                selecting = False
                                break
                            event = next((ev for ev in result.events if ev.kind == "transform"), None)
                            payload = event.data if event is not None else {}

                            # Attach to last move for undo
                            if self.move_history:
                                self.move_history[-1]["transformation"] = {
                                    "pos": pos,
                                    "player": payload.get("player", piece.player),
                                    "old_type": payload.get("old_type", piece.type),
                                    "new_type": payload.get("new_type", new_type),
                                    "old_square": payload.get("old_square"),
                                    "new_square": payload.get("new_square"),
                                }

                            selecting = False
                            break

            # Draw full scene, then overlay
            self._draw()

            pygame.draw.rect(self.screen, panel_color, (panel_x, panel_y, panel_w, panel_h), border_radius=10)
            pygame.draw.rect(self.screen, border_color, (panel_x, panel_y, panel_w, panel_h), width=2, border_radius=10)
            for img, (x, y) in icons:
                self.screen.blit(img, (x, y))

            pygame.display.flip()
            await asyncio.sleep(0)
            self.clock.tick(30)

    # ------------------------------------------------------------------ #

    def _draw_hud(self) -> None:
        cfg = self.cfg

        # ─── NEW: timer read‑outs ───────────────────────────────────────────
        def fmt(t: float) -> str:
            return f"{int(t)//60:02d}:{int(t)%60:02d}"

        black_t = "UNTIMED" if self.untimed else fmt(self.time_left["Black"])
        white_t = "UNTIMED" if self.untimed else fmt(self.time_left["White"])

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

        # --- scoreboard: specials control meter -----------------------
        sb_rect = pygame.Rect(self.SCOREBOARD_X, self.SCOREBOARD_Y, self.SCOREBOARD_W, self.SCOREBOARD_H)
        pygame.draw.rect(self.screen, cfg.GRAY, sb_rect, border_radius=10)
        pygame.draw.rect(self.screen, cfg.BLACK, sb_rect, 2, border_radius=10)

        row_h = sb_rect.h // 2
        top_rect = pygame.Rect(sb_rect.x, sb_rect.y, sb_rect.w, row_h)
        bot_rect = pygame.Rect(sb_rect.x, sb_rect.y + row_h, sb_rect.w, sb_rect.h - row_h)
        pygame.draw.rect(self.screen, cfg.BLACK, top_rect)
        pygame.draw.rect(self.screen, cfg.WHITE, bot_rect)

        black_cnt = len(self.board.controlled_squares["Black"])
        white_cnt = len(self.board.controlled_squares["White"])

        required = self.board.required_special_majority()
        claim = self.board.territory_claim
        black_hold = 0
        white_hold = 0
        if claim is not None:
            progress = max(0, min(1, self.turn_counter - claim.created_turn))
            if claim.claimant == "Black":
                black_hold = progress
            if claim.claimant == "White":
                white_hold = progress

        small = pygame.font.Font(None, max(16, int(self.cfg.SQ_SIZE * 0.32)))
        b_txt = f"Black: {black_cnt}/{required}  response {black_hold}/1"
        w_txt = f"White: {white_cnt}/{required}  response {white_hold}/1"
        self.screen.blit(small.render(b_txt, True, cfg.WHITE), (sb_rect.x + 12, sb_rect.y + 8))
        self.screen.blit(small.render(w_txt, True, cfg.BLACK), (sb_rect.x + 12, sb_rect.y + row_h + 8))

        # king danger icon on the meter
        threat = self._king_threat_state(AssaltoRealeApp.players[self.current_player])
        if threat is not None:
            self._draw_king_threat_icon(sb_rect, threat)

        # current player circle ---------------------------------------
        turn_colour = cfg.BLACK if self.current_player == 0 else cfg.WHITE
        pygame.draw.circle(self.screen, turn_colour, (self.SCOREBOARD_X - 40, self.SCOREBOARD_Y + self.SCOREBOARD_H // 2), 25)

        # --- reset / quit --------------------------------------------
        for x, y, label in [
            (self.RESET_X, self.RESET_Y, "RESET"),
            (self.QUIT_X, self.QUIT_Y, "MENU"),
        ]:
            pygame.draw.rect(self.screen, cfg.BUTTON_COLOR, (x, y, self.RESET_W, self.RESET_H))
            pygame.draw.rect(self.screen, cfg.BLACK, (x, y, self.RESET_W, self.RESET_H), 2)
            text_rect = self.font.render(label, True, cfg.WHITE)
            self.screen.blit(text_rect, (x + (self.RESET_W - text_rect.get_width()) // 2, y + 13))

        # --- placement icon ------------------------------------------
        if self.placing:
            next_ptype = self.board.next_piece_type_for(AssaltoRealeApp.players[self.current_player], self.pieces_left)
            if next_ptype:
                icon = self.assets.piece_images[AssaltoRealeApp.players[self.current_player]][next_ptype]
                icon = pygame.transform.scale(icon, (self.PLACEMENT_ICON_W  //3, self.PLACEMENT_ICON_H*2//3))
                ix = self.PLACEMENT_ICON_X + (self.PLACEMENT_ICON_W - icon.get_width() + 10) // 2
                iy = self.PLACEMENT_ICON_Y + (self.PLACEMENT_ICON_H - icon.get_height()) // 2
                self.screen.blit(icon, (ix, iy))

        # --- capture counter (very compact) ---------------------------


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

        # Draw capture panel last so buttons never cover it
        self._draw_capture_counter()

                # --- captured pieces on board margins in HUD ----------------
        icon_size = self.cfg.SQ_SIZE // 2
        spacing   = 4
        board_w_px = self.cfg.COLS * self.cfg.SQ_SIZE
        board_h_px = self.cfg.ROWS * self.cfg.SQ_SIZE




    def _draw_capture_counter(self) -> None:
        cfg = self.cfg
        piece_order = ["King", "AttackPawn", "DefensePawn", "ConquestPawn"]

        if not hasattr(self, "hud_rect"):
            return

        hud = self.hud_rect
        pad = 14

        # Place directly under the LOAD button, using whatever vertical space is left.
        y0 = hud.top + pad
        if hasattr(self, "LOAD_Y") and hasattr(self, "LOAD_H"):
            y0 = max(y0, int(self.LOAD_Y + self.LOAD_H + 14))

        x0 = hud.left + pad
        w = max(140, hud.w - 2 * pad)
        h = hud.bottom - pad - y0

        # If there's not enough room, draw a compact one-liner instead of an unusable panel.
        if h < 90:
            # Compact mode: keep the piece ICONS (not just totals)
            s = pygame.font.Font(None, max(16, int(self.cfg.SQ_SIZE * 0.30)))
            tiny = pygame.font.Font(None, max(14, int(self.cfg.SQ_SIZE * 0.26)))
            icon_sz = min(22, max(14, int(self.cfg.SQ_SIZE * 0.34)))
            pad_x, pad_y = 10, 8
            row_gap = 6

            rows = [("Black", "B"), ("White", "W")]

            # Measure needed width
            max_row_w = 0
            for player, lab in rows:
                label_s = s.render(f"{lab}:", True, cfg.WHITE)
                row_w = label_s.get_width() + 8
                for ptype in piece_order:
                    cnt = int(self.board.captured_pieces.get(player, {}).get(ptype, 0))
                    if cnt <= 0:
                        continue
                    row_w += icon_sz + 6
                max_row_w = max(max_row_w, row_w)

            box_w = max(180, max_row_w + 2 * pad_x)
            box_h = 2 * icon_sz + row_gap + 2 * pad_y

            bg = pygame.Surface((box_w, box_h), pygame.SRCALPHA).convert_alpha()
            bg.fill((0, 0, 0, 0))
            pygame.draw.rect(bg, (30, 30, 30, 180), bg.get_rect(), border_radius=10)
            pygame.draw.rect(bg, (255, 255, 255), bg.get_rect(), 2, border_radius=10)

            y = pad_y
            for player, lab in rows:
                label_s = s.render(f"{lab}:", True, cfg.WHITE)
                bg.blit(label_s, (pad_x, y + (icon_sz - label_s.get_height()) // 2))
                x = pad_x + label_s.get_width() + 8

                for ptype in piece_order:
                    cnt = int(self.board.captured_pieces.get(player, {}).get(ptype, 0))
                    if cnt <= 0:
                        continue

                    icon = pygame.transform.smoothscale(self.assets.piece_images[player][ptype], (icon_sz, icon_sz))
                    bg.blit(icon, (x, y))

                    # Small count badge (only if >1)
                    if cnt > 1:
                        badge = tiny.render(str(cnt), True, cfg.WHITE)
                        br = badge.get_rect()
                        bx = x + icon_sz - br.w - 2
                        by = y + icon_sz - br.h - 2
                        pygame.draw.rect(bg, (0, 0, 0, 160), (bx - 2, by - 1, br.w + 4, br.h + 2), border_radius=4)
                        bg.blit(badge, (bx, by))

                    x += icon_sz + 6

                y += icon_sz + row_gap

            # Draw just above the capture area, under the LOAD button
            dest_x = x0
            dest_y = y0  # directly under LOAD button / top padding
            # Clamp inside the HUD rect
            dest_y = max(hud.top + pad, min(dest_y, hud.bottom - pad - box_h))
            self.screen.blit(bg, (dest_x, dest_y))
            return
        # Rounded, mostly-opaque panel (prevents "background tint" artifacts in fullscreen)
        panel = pygame.Surface((w, h), pygame.SRCALPHA).convert_alpha()
        panel.fill((0, 0, 0, 0))
        R = 12
        pygame.draw.rect(panel, (30, 30, 30, 235), panel.get_rect(), border_radius=R)
        pygame.draw.rect(panel, (255, 255, 255, 255), panel.get_rect(), 2, border_radius=R)
        title_font = pygame.font.Font(None, max(18, int(self.cfg.SQ_SIZE * 0.36)))
        small_font = pygame.font.Font(None, max(16, int(self.cfg.SQ_SIZE * 0.32)))

        panel.blit(title_font.render("Captured", True, cfg.WHITE), (10, 8))

        # Two sections: Black lost (top), White lost (bottom)
        icon_sz = min(30, max(18, int(self.cfg.SQ_SIZE * 0.42)))
        col_gap = 10
        row_gap = 8

        # Helper to draw one player's row of counts: icon + "xN"
        def draw_counts(player: str, top_y: int):
            label = f"{player} lost:"
            panel.blit(small_font.render(label, True, cfg.WHITE), (10, top_y))
            x = 10 + small_font.size(label)[0] + 10
            y = top_y - 2
            for ptype in piece_order:
                cnt = int(self.board.captured_pieces.get(player, {}).get(ptype, 0))
                # Show only nonzero counts to save space
                if cnt <= 0:
                    continue
                icon = pygame.transform.scale(self.assets.piece_images[player][ptype], (icon_sz, icon_sz))
                panel.blit(icon, (x, y))
                x += icon_sz + 4
                panel.blit(small_font.render(f"x{cnt}", True, cfg.WHITE), (x, y + 4))
                x += small_font.size(f"x{cnt}")[0] + col_gap

        draw_counts("Black", 40)
        draw_counts("White", 40 + icon_sz + row_gap)

        # Finally blit panel to screen
        self.screen.blit(panel, (x0, y0))

    async def _animate_bounce(
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
            await asyncio.sleep(step_delay_ms / 1000.0)

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
            self.board_surface.blit(overlay, (c * self.cfg.SQ_SIZE, r * self.cfg.SQ_SIZE))

        for key in expired:
            del self._flash_effects[key]

    async def _animate_king_attack(self, pos: Vec2) -> None:
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
            pygame.draw.circle(overlay, (255, 100, 0), center, radius, width=4)
            overlay.set_alpha(alpha)

            # Blit the effect on top of the board area (accounting for layout offset)
            self.screen.blit(overlay, self.board_grid_rect.topleft)
            pygame.display.flip()
            await asyncio.sleep(0)
            clock.tick(60)



    async def _flash_winner_king(self, winner: str,
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
                overlay,
                (self.board_grid_rect.x + c * self.cfg.SQ_SIZE, self.board_grid_rect.y + r * self.cfg.SQ_SIZE),
            )
            pygame.display.flip()
            await asyncio.sleep(0)
            await asyncio.sleep(0.05)

        # self.running = False                # end the game gracefully


    def _draw_placement_overlay(self) -> None:
        if not self.placing:
            return

        player = AssaltoRealeApp.players[self.current_player]
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
                    self.board_surface.blit(tint, (c * self.cfg.SQ_SIZE, r * self.cfg.SQ_SIZE))


    # ======================== helpers ========================
    # =========================== AI (single-player) ========================== #
    async def _maybe_ai_step(self) -> None:
        """If Human vs Computer and it's the AI's turn, perform ONE paced action.

        Important: do not run the whole AI turn in one go, otherwise the UI
        freezes and the move animation becomes invisible.
        """
        if (not self.vs_ai) or (not self.running) or self.menu_active or self.return_to_menu:
            return

        ai = self.ai_side
        if AssaltoRealeApp.players[self.current_player] != ai:
            return

        now = pygame.time.get_ticks()
        if now < self._ai_next_tick:
            return

        # schedule next AI action *after* we do this one
        # (updated again below depending on phase)
        if self.placing:
            move_delay = self.ai_delay_ms_place
            # place a single piece
            r, c = self._ai_choose_placement()
            if r is None:
                self._end_turn()
            else:
                self._handle_placement_click((r, c))
        else:
            move_delay = self.ai_delay_ms_move

            # If we don't already have a plan for this AI turn, compute one (2-ply minimax).
            if not self._ai_plan:
                self._ai_plan = self._ai_pick_best_turn_plan()

            if not self._ai_plan:
                self._end_turn()
            else:
                start, end = self._ai_plan.pop(0)
                self.selected = None
                await self._attempt_move(start, end)

        self._ai_next_tick = pygame.time.get_ticks() + int(move_delay)


    async def _ai_place_until_turn_switch(self) -> None:
        ai = self.ai_side
        guard = 0
        while self.running and self.placing and AssaltoRealeApp.players[self.current_player] == ai:
            choice = self._ai_choose_placement()
            if choice is None:
                # Shouldn't happen, but don't soft-lock.
                self._switch_player()
                return
            self._handle_placement_click(choice)
            guard += 1
            if guard > 40:
                return
            await asyncio.sleep(0)

    def _ai_choose_placement(self) -> Optional[Vec2]:
        """Pick a legal placement square for the current AI piece."""
        player = self.ai_side
        ptype = self.board.next_piece_type_for(player, self.pieces_left)
        if ptype is None:
            return None

        # locate our king (if already placed)
        king_pos: Optional[Vec2] = None
        for rr in range(self.cfg.ROWS):
            for cc in range(self.cfg.COLS):
                p = self.board[rr][cc]
                if p and p.player == player and p.type == "King":
                    king_pos = (rr, cc)
                    break
            if king_pos:
                break

        # target anchors
        if ptype == "King":
            target_r = self.cfg.ROWS // 2
            target_c = self.cfg.COLS // 4 if player == "Black" else (3 * self.cfg.COLS) // 4
        elif ptype == "DefensePawn" and king_pos is not None:
            target_r, target_c = king_pos
        else:
            target_r = self.cfg.ROWS // 2
            # keep attacks near their allowed columns; keep others nearer midline
            if ptype == "AttackPawn":
                target_c = 0 if player == "Black" else self.cfg.COLS - 1
            else:
                target_c = self.cfg.COLS // 2

        best: Optional[Vec2] = None
        best_score = -1e18

        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                if self.board[r][c] is not None:
                    continue
                if self.board.square_disallowed_for_placement(r, c, player, ptype):
                    continue

                score = 0.0

                # general: stay near target anchor
                score -= 2.0 * (abs(r - target_r) + abs(c - target_c))

                # conquest: be as close as possible to special squares while respecting the >=3 rule
                if ptype == "ConquestPawn" and self.board.special_squares:
                    d = min(max(abs(r - sr), abs(c - sc)) for (sr, sc) in self.board.special_squares)
                    score += 40.0 / max(1.0, d)  # closer is better

                # defense: prefer adjacent to king (to enable the "defended king" rule)
                if ptype == "DefensePawn" and king_pos is not None:
                    kr, kc = king_pos
                    dd = max(abs(r - kr), abs(c - kc))
                    if dd == 1:
                        score += 80.0
                    elif dd == 2:
                        score += 25.0

                # tiny noise to break ties
                score += random.random() * 0.01

                if score > best_score:
                    best_score = score
                    best = (r, c)

        return best

    async def _ai_play_turn(self) -> None:
        """Play up to 2 moves for the AI side."""
        ai = self.ai_side
        guard = 0

        while (
            self.running
            and (not self.placing)
            and (not self.menu_active)
            and (not self.return_to_menu)
            and AssaltoRealeApp.players[self.current_player] == ai
        ):
            move = self._ai_pick_best_move()
            if move is None:
                # no legal moves; just end the turn
                self._end_turn()
                return

            start, end = move
            self.selected = None
            await self._attempt_move(start, end)

            guard += 1
            if guard > 3:  # safety
                return

            await asyncio.sleep(0)

    def _ai_pick_best_move(self) -> Optional[Tuple[Vec2, Vec2]]:
        ai = self.ai_side
        opp = "Black" if ai == "White" else "White"

        legal = self._ai_generate_legal_moves(ai, self.board, self.moves_this_turn, self.king_moved)
        if not legal:
            return None

        # current control count (for delta scoring)
        base_ctrl = len(self.board.controlled_squares[ai])

        best = None
        best_score = -1e18

        for start, end in legal:
            mover = self.board[start[0]][start[1]]
            if mover is None:
                continue

            b2, meta = self._ai_simulate_move(
                self.board,
                start,
                end,
                moves_this_turn=self.moves_this_turn,
                king_moved=self.king_moved,
            )
            winner = meta["winner"]
            move_cost = meta["move_cost"]
            end_pos = meta["end_pos"]
            captured = meta["captured_type"]
            defended_king = meta["defended_king"]

            # immediate win/loss
            if winner == ai:
                return (start, end)  # do it
            if winner == opp:
                continue

            # --- smarter scoring: position eval + opponent best-reply threat ---
            # Start from a cheap position evaluation (material + specials + king safety)
            score = self._ai_eval_position(b2, ai)

            # Keep the "don't move away a defense pawn that guards our king" heuristic
            if mover.type == "DefensePawn" and self.board.defense_pawn_guards_king(start[0], start[1]):
                score -= 25.0

            # Encourage immediate tactical gain (captures already reflected by eval, but give a bump)
            if captured is not None:
                bump = {"AttackPawn": 45, "DefensePawn": 70, "ConquestPawn": 60, "King": 0}.get(captured, 0)
                score += 0.6 * bump

            # Penalize the opponent's best immediate reply (prevents obvious blunders)
            threat = self._ai_best_opponent_threat(b2, ai)
            score -= 0.85 * threat

            # Prefer cheaper moves on the 1st action (keeps options open)
            if self.moves_this_turn == 0:
                score += 6.0 / max(1, move_cost)

            # tiny noise for variety
            score += random.random() * 0.03

            if score > best_score:
                best_score = score
                best = (start, end)

        return best

    def _ai_generate_legal_moves(
        self, player: str, board: Board, moves_this_turn: int, king_moved: bool
    ) -> List[Tuple[Vec2, Vec2]]:
        """Return engine-authored legal actions as legacy (start, end) pairs."""
        return [
            (action.start, action.end)
            for action in board.legal_actions(
                player,
                moves_this_turn=moves_this_turn,
                king_moved=king_moved,
                include_pass=False,
            )
            if action.start is not None and action.end is not None
        ]

    def _ai_find_king(self, board: Board, player: str) -> Optional[Vec2]:
        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                p = board[r][c]
                if p and p.player == player and p.type == "King":
                    return (r, c)
        return None
    def _ai_king_is_undefended_and_capturable(self, board: Board, player: str) -> bool:
        """True if the king has NO adjacent DefensePawn and can be captured immediately by an enemy AttackPawn."""
        opp = "Black" if player == "White" else "White"
        kpos = self._ai_find_king(board, player)
        if kpos is None:
            return True

        kr, kc = kpos
        # Defended King -> not immediately capturable under the bounce rule.
        if board.get_defense_adjacent_to_king(kr, kc, player) is not None:
            return False

        # check immediate capture by an enemy AttackPawn (first action or second action)
        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                p = board[r][c]
                if not p or p.player != opp or p.type != "AttackPawn":
                    continue
                if p.valid_move(board, (r, c), (kr, kc), 0) or p.valid_move(board, (r, c), (kr, kc), 1):
                    return True
        return False

    def _ai_piece_score_value(self, ptype: str) -> float:
        # Values here are *tactical* (used for threats/hanging), not the big strategic eval.
        return {
            "AttackPawn": 1.0,
            "DefensePawn": 1.2,
            "ConquestPawn": 1.6,
            "King": 5.0,
        }.get(ptype, 1.0)

    def _ai_tactical_threats(self, board: Board, player: str) -> Tuple[float, float]:
        """Radius-2 tactical scan.

        Returns:
            (threat_value, hanging_value)

        threat_value: how much material we are threatening to capture soon.
        hanging_value: how much of our own material is hanging (capturable) without a simple counter-threat.

        This is the "pieces should cooperate" glue: prefer positions where threatened pieces are either
        (a) safe, (b) can counter-capture the attacker, or (c) can move away.
        """
        opp = "Black" if player == "White" else "White"

        my_pieces = []
        opp_pieces = []
        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                p = board[r][c]
                if not p:
                    continue
                if p.player == player:
                    my_pieces.append((r, c, p))
                else:
                    opp_pieces.append((r, c, p))

        def cheb(a, b):
            return max(abs(a[0] - b[0]), abs(a[1] - b[1]))

        # --- threatened enemy material (one-step tactical pressure) ---
        threatened_enemy = set()
        for er, ec, ep in opp_pieces:
            # Only consider enemies within radius 2 of *some* of our pieces (cheap prefilter)
            for mr, mc, mp in my_pieces:
                if cheb((mr, mc), (er, ec)) > 2:
                    continue
                # allow capture in either action slot (mt 0 or 1)
                if mp.valid_move(board, (mr, mc), (er, ec), 0) or mp.valid_move(board, (mr, mc), (er, ec), 1):
                    threatened_enemy.add((er, ec))
                    break

        threat_value = 0.0
        for er, ec in threatened_enemy:
            ep = board[er][ec]
            if ep:
                threat_value += self._ai_piece_score_value(ep.type)

        # --- our hanging material ---
        hanging_value = 0.0

        for mr, mc, mp in my_pieces:
            # find enemy attackers that can capture us (radius 2 capture rules)
            attackers = []
            for er, ec, ep in opp_pieces:
                if cheb((mr, mc), (er, ec)) > 2:
                    continue
                if ep.valid_move(board, (er, ec), (mr, mc), 0) or ep.valid_move(board, (er, ec), (mr, mc), 1):
                    attackers.append((er, ec, ep))

            if not attackers:
                continue

            # "equal threat" / counter-threat: can we capture at least one attacker right now?
            counter = False
            for er, ec, ep in attackers:
                for fr, fc, fp in my_pieces:
                    if cheb((fr, fc), (er, ec)) > 2:
                        continue
                    if fp.valid_move(board, (fr, fc), (er, ec), 0) or fp.valid_move(board, (fr, fc), (er, ec), 1):
                        counter = True
                        break
                if counter:
                    break

            v = self._ai_piece_score_value(mp.type)
            # Special-square Conquest is extra fragile: if you lose it, you lose control too.
            if mp.type == "ConquestPawn" and (mr, mc) in board.special_squares:
                v *= 2.6
            elif (mr, mc) in board.special_squares:
                v *= 1.35

            if counter:
                hanging_value += 0.28 * v
            else:
                hanging_value += 1.0 * v

        return threat_value, hanging_value


    def _ai_eval_position(self, board: Board, ai: str) -> float:
        """Evaluation from `ai` perspective (biased toward specials & their defense).

        Key goals:
        - Prioritize conquering/holding special squares.
        - Still avoid immediate king-loss blunders, but don't over-invest in turtling.
        """
        opp = "Black" if ai == "White" else "White"

        # Material: Conquest is strategically important; Defense is useful but shouldn't dominate.
        piece_val = {"AttackPawn": 1.0, "DefensePawn": 1.1, "ConquestPawn": 1.7, "King": 0.0}

        mat_ai = 0.0
        mat_opp = 0.0
        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                p = board[r][c]
                if not p:
                    continue
                v = piece_val.get(p.type, 0.0)
                if p.player == ai:
                    mat_ai += v
                else:
                    mat_opp += v

        ctrl_ai = len(board.controlled_squares[ai])
        ctrl_opp = len(board.controlled_squares[opp])
        required = board.required_special_majority()

        MAT_W = 150.0
        SPEC_W = 420.0

        score = MAT_W * (mat_ai - mat_opp) + SPEC_W * (ctrl_ai - ctrl_opp)

        # Big milestone: reaching/denying strict Special Square majority
        if ctrl_ai >= required:
            score += 420.0
        if ctrl_opp >= required:
            score -= 420.0

        # Defend controlled specials: reward having nearby friendly guards (Defense preferred).
        neigh8 = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]

        def guard_bonus(player: str) -> float:
            b = 0.0
            for (sr, sc) in board.controlled_squares[player]:
                has_guard = False
                for dr, dc in neigh8:
                    rr, cc = sr + dr, sc + dc
                    if 0 <= rr < self.cfg.ROWS and 0 <= cc < self.cfg.COLS:
                        q = board[rr][cc]
                        if q and q.player == player:
                            has_guard = True
                            if q.type == "DefensePawn":
                                b += 24.0
                            elif q.type == "AttackPawn":
                                b += 14.0
                            else:
                                b += 8.0
                            break
                if not has_guard:
                    b -= 26.0
            return b

        score += guard_bonus(ai) - 0.85 * guard_bonus(opp)

        # Potential to conquer: Conquest pawns close to unclaimed specials are valuable.
        unclaimed = set(board.special_squares)
        unclaimed.difference_update(board.controlled_squares[ai])
        unclaimed.difference_update(board.controlled_squares[opp])

        if unclaimed:
            def proximity(player: str) -> float:
                pts = []
                for r in range(self.cfg.ROWS):
                    for c in range(self.cfg.COLS):
                        p = board[r][c]
                        if p and p.player == player and p.type == "ConquestPawn":
                            pts.append((r, c))
                if not pts:
                    return 0.0
                s = 0.0
                for pr, pc in pts:
                    # nearest unclaimed special (Chebyshev distance)
                    d = min(max(abs(pr - sr), abs(pc - sc)) for (sr, sc) in unclaimed)
                    if d == 1:
                        s += 40.0
                    elif d == 2:
                        s += 18.0
                return s

            score += proximity(ai) - 0.7 * proximity(opp)


        # --- local tactics (radius 2): avoid hanging pieces & create threats ---
        # This is what makes two-move play smarter: "reposition to threaten" becomes valuable,
        # and "grab a defended special" becomes expensive unless it is tactically justified.
        thr_ai, hang_ai = self._ai_tactical_threats(board, ai)
        thr_opp, hang_opp = self._ai_tactical_threats(board, opp)

        TACT_W = 70.0
        HANG_W = 120.0
        score += TACT_W * (thr_ai - 0.85 * thr_opp)
        score += HANG_W * (0.85 * hang_opp - hang_ai)

        # King safety: huge penalty only for immediate, undefended capturability.
        if self._ai_king_is_undefended_and_capturable(board, ai):
            score -= 5000.0
        if self._ai_king_is_undefended_and_capturable(board, opp):
            score += 1300.0

        # Small nudge if king is defended (no penalty if not).
        kpos = self._ai_find_king(board, ai)
        if kpos is not None:
            kr, kc = kpos
            if board.get_defense_adjacent_to_king(kr, kc, ai) is not None:
                score += 10.0

        return score

    def _ai_best_opponent_threat(self, board_after: Board, ai: str) -> float:
        """How bad can the opponent make it immediately after our move?

        Not a full minimax. Just a 1-move opponent 'best reply' threat estimate:
        winning moves dominate, otherwise captures + special control + king danger.
        """
        opp = "Black" if ai == "White" else "White"
        legal_opp = self._ai_generate_legal_moves(opp, board_after, moves_this_turn=0, king_moved=False)
        if not legal_opp:
            return 0.0

        base_ctrl = len(board_after.controlled_squares[opp])
        values = {"AttackPawn": 45, "DefensePawn": 70, "ConquestPawn": 60, "King": 10_000}

        worst = 0.0
        for s, e in legal_opp:
            b3, meta = self._ai_simulate_move(board_after, s, e, moves_this_turn=0, king_moved=False)
            if meta["winner"] == opp:
                return 1e7  # immediate loss for us next turn

            t = 0.0
            cap = meta["captured_type"]
            if cap:
                t += values.get(cap, 0)

            # special control swing for opp
            ctrl_after = len(b3.controlled_squares[opp])
            t += (ctrl_after - base_ctrl) * 180.0
            if ctrl_after >= board_after.required_special_majority():
                t += 140.0

            # if this reply leaves our king in immediate capture danger, that's very bad
            if self._ai_king_is_undefended_and_capturable(b3, ai):
                t += 4000.0

            worst = max(worst, t)

        return worst


    # ------------------------- minimax (2-ply, turn-based) ------------------------- #
    def _ai_turn_sequences(
        self,
        player: str,
        board: Board,
        moves_this_turn: int,
        king_moved: bool,
        topk1: int = 12,
        topk2: int = 10,
    ) -> List[Tuple[float, Board, Optional[str], List[Tuple[Vec2, Vec2]]]]:
        '''Generate candidate sequences for a full turn (1 or 2 actions).

        Returns tuples:
            (ordering_score, board_after_turn, winner, sequence)

        ordering_score is for pruning/ordering only.
        '''
        ai = self.ai_side  # evaluation perspective

        def pref_score(b: Board, meta: dict, mover_player: str) -> float:
            # base eval from AI perspective
            base = self._ai_eval_position(b, ai)

            # tactical bump for captures
            cap = meta.get("captured_type")
            if cap:
                base += {"AttackPawn": 45, "DefensePawn": 70, "ConquestPawn": 60, "King": 0}.get(cap, 0) * 0.55

            # specials swing for the mover this action
            base_ctrl = len(board.controlled_squares[mover_player])
            ctrl_after = len(b.controlled_squares[mover_player])
            base += (ctrl_after - base_ctrl) * 280.0

            # mover preference: AI maximizes base, opponent minimizes base
            return base if mover_player == ai else -base

        first_moves = self._ai_generate_legal_moves(player, board, moves_this_turn, king_moved)
        if not first_moves:
            return []

        cand1 = []
        for s, e in first_moves:
            b1, meta1 = self._ai_simulate_move(
                board,
                s,
                e,
                moves_this_turn=moves_this_turn,
                king_moved=king_moved,
            )
            win1 = meta1.get("winner")
            score1 = pref_score(b1, meta1, player)
            cand1.append((score1, b1, win1, [(s, e)], meta1))

        cand1.sort(key=lambda t: t[0], reverse=True)
        # Never prune captures: tactical replies (like recapturing a suicidal Conquest on a special)
        # must stay in the tree, otherwise the AI looks blind.
        cap1 = [t for t in cand1 if t[4].get("captured_type") is not None or t[4].get("defended_king")]
        non1 = [t for t in cand1 if t not in cap1]
        keep = cap1 + non1[:max(0, topk1 - len(cap1))]
        cand1 = keep

        sequences: List[Tuple[float, Board, Optional[str], List[Tuple[Vec2, Vec2]]]] = []

        for s1, b1, win1, seq1, meta1 in cand1:
            # option: stop after first action
            sequences.append((s1, b1, win1, seq1))

            if win1 is not None:
                continue

            move_cost = int(meta1.get("move_cost", 1))
            mt2 = moves_this_turn + move_cost
            if mt2 >= 2:
                continue  # no second action

            km2 = bool(meta1.get("king_moved", king_moved))
            second_moves = self._ai_generate_legal_moves(player, b1, mt2, km2)
            if not second_moves:
                continue

            cand2 = []
            for s2, e2 in second_moves:
                b2, meta2 = self._ai_simulate_move(
                    b1,
                    s2,
                    e2,
                    moves_this_turn=mt2,
                    king_moved=km2,
                )
                win2 = meta2.get("winner")
                score2 = pref_score(b2, meta2, player)
                cand2.append((s1 + 0.85 * score2, b2, win2, seq1 + [(s2, e2)]))

            cand2.sort(key=lambda t: t[0], reverse=True)
            for order_score, b2, win2, seq2 in cand2[:topk2]:
                sequences.append((order_score, b2, win2, seq2))

        sequences.sort(key=lambda t: t[0], reverse=True)
        return sequences[: self.ai_max_sequences]

    def _ai_tt_key(self, board: Board, to_move: str, depth: int) -> Tuple:
        '''Hashable key for the transposition table (TT).'''
        grid_codes: List[str] = []
        for r in range(self.cfg.ROWS):
            for c in range(self.cfg.COLS):
                p = board[r][c]
                if p is None:
                    grid_codes.append(".")
                else:
                    # 2-char code: player initial + piece initial (A/D/C/K)
                    grid_codes.append(p.player[0] + p.type[0])

        b_ctrl = tuple(sorted(board.controlled_squares["Black"]))
        w_ctrl = tuple(sorted(board.controlled_squares["White"]))
        specials = tuple(sorted(board.special_squares))
        transforms = tuple(sorted(board.transform_squares))

        return (to_move, depth, tuple(grid_codes), b_ctrl, w_ctrl, specials, transforms)

    def _ai_minimax_turnnode(
        self,
        board: Board,
        to_move: str,
        depth_turns: int,
        alpha: float,
        beta: float,
        start_ms: int,
    ) -> float:
        '''Alpha-beta minimax where each ply is a full turn (1 or 2 actions).'''
        ai = self.ai_side
        opp = "Black" if ai == "White" else "White"

        # time budget guard
        if pygame.time.get_ticks() - start_ms > self.ai_time_budget_ms:
            return self._ai_eval_position(board, ai)

        if depth_turns <= 0:
            return self._ai_eval_position(board, ai)

        key = self._ai_tt_key(board, to_move, depth_turns)
        if key in self._ai_tt:
            return self._ai_tt[key]

        # branch caps: slightly tighter deeper in the tree
        if depth_turns >= 2:
            topk1, topk2 = self.ai_topk1, self.ai_topk2
        else:
            topk1, topk2 = max(12, self.ai_topk1 - 4), max(10, self.ai_topk2 - 4)

        seqs = self._ai_turn_sequences(
            to_move,
            board,
            moves_this_turn=0,
            king_moved=False,
            topk1=topk1,
            topk2=topk2,
        )
        if not seqs:
            val = self._ai_eval_position(board, ai)
            self._ai_tt[key] = val
            return val

        if to_move == ai:
            best = -1e18
            for _order, b_after, winner, _seq in seqs:
                if winner == ai:
                    val = 1e9
                elif winner == opp:
                    val = -1e9
                else:
                    val = self._ai_minimax_turnnode(b_after, opp, depth_turns - 1, alpha, beta, start_ms)

                if val > best:
                    best = val
                if best > alpha:
                    alpha = best
                if alpha >= beta:
                    break
        else:
            best = 1e18
            for _order, b_after, winner, _seq in seqs:
                if winner == opp:
                    val = -1e9
                elif winner == ai:
                    val = 1e9
                else:
                    val = self._ai_minimax_turnnode(b_after, ai, depth_turns - 1, alpha, beta, start_ms)

                if val < best:
                    best = val
                if best < beta:
                    beta = best
                if alpha >= beta:
                    break

        self._ai_tt[key] = best
        return best

    def _ai_pick_best_turn_plan(self) -> List[Tuple[Vec2, Vec2]]:
        '''Beefier turn-level minimax with alpha-beta + TT.

        ai_depth_turns is measured in turns:
          3 = AI now, opponent reply, AI next.
        '''
        ai = self.ai_side
        opp = "Black" if ai == "White" else "White"

        # If mid-turn, only plan the remaining single action.
        if self.moves_this_turn != 0:
            mv = self._ai_pick_best_move()
            return [mv] if mv else []

        # reset TT each decision (keeps memory bounded + avoids stale state)
        self._ai_tt = {}
        start_ms = pygame.time.get_ticks()

        ai_seqs = self._ai_turn_sequences(
            ai,
            self.board,
            moves_this_turn=0,
            king_moved=self.king_moved,
            topk1=self.ai_topk1,
            topk2=self.ai_topk2,
        )
        if not ai_seqs:
            return []

        # immediate win path
        for _o, _b, winner, seq in ai_seqs:
            if winner == ai:
                return seq

        best_score = -1e18
        best_seq: List[Tuple[Vec2, Vec2]] = []
        alpha = -1e18
        beta = 1e18

        depth_after_root = max(0, self.ai_depth_turns - 1)

        for _order, b_after_ai, winner_ai, seq_ai in ai_seqs:
            if winner_ai == opp:
                continue
            if winner_ai == ai:
                return seq_ai

            if depth_after_root == 0:
                score = self._ai_eval_position(b_after_ai, ai)
            else:
                score = self._ai_minimax_turnnode(b_after_ai, opp, depth_after_root, alpha, beta, start_ms)

            if score > best_score:
                best_score = score
                best_seq = seq_ai

            if best_score > alpha:
                alpha = best_score
            if alpha >= beta:
                break

            # time budget early exit
            if pygame.time.get_ticks() - start_ms > self.ai_time_budget_ms:
                break

        return best_seq


    def _ai_simulate_move(
        self,
        board: Board,
        start: Vec2,
        end: Vec2,
        *,
        moves_this_turn: int = 0,
        king_moved: bool = False,
    ) -> Tuple[Board, dict]:
        """Simulate a move through the authoritative engine (no animations)."""
        b2: Board = copy.deepcopy(board)
        action = b2.build_action(
            start,
            end,
            moves_this_turn=moves_this_turn,
            king_moved=king_moved,
        )
        if action.defended_king is not None and action.selected_defender is None:
            target = b2[end[0]][end[1]]
            if target is not None:
                defenders = list(b2.adjacent_defenders_for_king(end, target.player))
                chosen = self._ai_choose_defender_for_bounce(
                    b2,
                    start,
                    end,
                    target.player,
                    defenders,
                    moves_this_turn=moves_this_turn,
                    king_moved=king_moved,
                )
                if chosen is not None:
                    action = b2.build_action(
                        start,
                        end,
                        moves_this_turn=moves_this_turn,
                        king_moved=king_moved,
                        selected_defender=chosen,
                    )
        meta = {
            "winner": None,
            "captured_type": action.captured_piece_type,
            "defended_king": action.defended_king is not None,
            "selected_defender": action.selected_defender,
            "end_pos": action.defended_king.landing_position if action.defended_king else end,
            "move_cost": action.cost or 1,
            "king_moved": king_moved,
        }
        if action.error is not None:
            meta["illegal"] = action.error
            return b2, meta

        result = b2.apply_action(
            action,
            moves_this_turn=moves_this_turn,
            king_moved=king_moved,
        )
        if result.error is not None:
            meta["illegal"] = result.error
            return b2, meta
        if result.victory is not None:
            meta["winner"] = result.victory.winner
        meta["move_cost"] = action.cost
        meta["king_moved"] = king_moved or (
            b2[meta["end_pos"][0]][meta["end_pos"][1]] is not None
            and b2[meta["end_pos"][0]][meta["end_pos"][1]].type == "King"
        )
        return b2, meta

    def _ai_auto_transform(self, pos: Vec2, piece: Piece) -> None:
        """Auto-select a pawn transformation for AI (no UI prompt)."""
        options = ["AttackPawn", "DefensePawn", "ConquestPawn"]

        # Evaluate each option by immediate tactical opportunities (captures / special control).
        best_t = piece.type
        best_score = -1e18

        for opt in options:
            b2 = copy.deepcopy(self.board)
            b2[pos[0]][pos[1]] = Piece.create(opt, piece.player)

            # quick score: #captures available next, special control
            score = 0.0
            p2 = b2[pos[0]][pos[1]]
            if p2 is None:
                continue

            # special control value
            if opt == "ConquestPawn" and pos in b2.special_squares:
                score += 50.0

            # immediate captures from this square on next first-move
            for r in range(self.cfg.ROWS):
                for c in range(self.cfg.COLS):
                    if p2.valid_move(b2, pos, (r, c), 0) and b2[r][c] is not None and b2[r][c].player != piece.player:
                        score += 10.0
                        if b2[r][c].type == "King":
                            score += 500.0

            score += random.random() * 0.01
            if score > best_score:
                best_score = score
                best_t = opt

        result = self.board.transform_piece(pos, best_t)
        if result.error is not None:
            self._set_toast(result.error)
            return
        event = next((ev for ev in result.events if ev.kind == "transform"), None)
        payload = event.data if event is not None else {}

        if self.move_history:
            self.move_history[-1]["transformation"] = {
                "pos": pos,
                "player": payload.get("player", piece.player),
                "old_type": payload.get("old_type", piece.type),
                "new_type": payload.get("new_type", best_t),
                "old_square": payload.get("old_square"),
                "new_square": payload.get("new_square"),
            }

    # ======================================================================= #
    def _compute_valid_moves(self, piece: Piece, pos: Vec2) -> List[Vec2]:
        return [
            action.end
            for action in self.board.legal_actions(
                piece.player,
                moves_this_turn=self.moves_this_turn,
                king_moved=self.king_moved,
                include_pass=False,
            )
            if action.start == pos and action.end is not None
        ]
    
    def _check_special_squares(self) -> None:
        self.board.update_control()
        claim = self.board.territory_claim
        self.candidate_winner = claim.claimant if claim else None
        self.candidate_turn_index = claim.created_turn if claim else None

    def _check_candidate_win(self) -> None:
        territory_win = self.board.refresh_territory_claim(turn_counter=self.turn_counter)
        self._check_special_squares()
        if territory_win is not None:
            self._show_endgame_menu(territory_win.winner)

    async def _animate_slide(
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

            draw_board(self.board, self.board_surface, self.font, self.selected, [], cfg=self.cfg, assets=self.assets)

            # then blit the board_surface where it belongs
            self.screen.blit(self.board_surface, self.board_surf_rect.topleft)

            # draw the floating piece with board offset
            rect = img.get_rect(center=(self.board_surf_rect.x + cx, self.board_surf_rect.y + cy))
            self.screen.blit(img, rect)

            # draw HUD normally
            self._draw_hud()
            pygame.display.flip()


            if t >= 1.0:
                break
            clock.tick(60)
