from __future__ import annotations

import asyncio
import os
import sys
import copy
from typing import Dict, List, Optional, Tuple

import pygame

from assalto_core import Board, GameConfig, Piece, Vec2
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
        self.timer_options   = [5*60, 10*60, 12*60, 15*60, 20*60]
        self.timer_index     = 2
        self.board_sizes     = [(8,8), (10,10), (12,12), (14,14), (16,16), (18,18)]
        self.board_index     = 2
        self.special_options = [3, 4, 5, 6, 7]
        self.special_index   = self.special_options.index(5)
        self.settings: Dict[str, object] = {}

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
        self.running: bool = True
        self.candidate_winner: Optional[str] = None
        self.candidate_turn_index: Optional[int] = None
        self.both_at_four: bool = False
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
        self.SCOREBOARD_W, self.SCOREBOARD_H = full_w, 78
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


    async def _show_start_menu(self) -> None:
        # Fonts and image codecs can differ between desktop and web.
        # Keep the menu resilient: if a font or a JPEG decode fails, we still render.
        try:
            title_f = pygame.font.SysFont("bookmanoldstyle", 48, bold=True)
            sub_f   = pygame.font.SysFont("bookmanoldstyle", 30)
        except Exception:
            title_f = pygame.font.Font(None, 48)
            sub_f   = pygame.font.Font(None, 30)

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
                creator_pos  = (130, self.SCR_H - 20 - creator_img.get_height())
                caption_surf = sub_f.render("The creators of  Assalto Reale:", True, (255,255,255))
                caption_pos  = (20, creator_pos[1] - creator_img.get_height()//2)
        except Exception:
            # Skip creators block if it cannot be loaded.
            creator_img = None

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
                    self.running = False; return
                if ev.type == pygame.MOUSEBUTTONDOWN:
                    mx, my = ev.pos
                    if quit_rect.collidepoint(mx, my):
                        self.running = False; return

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

            # creators image (optional)
            if creator_img is not None and creator_pos is not None:
                self.screen.blit(creator_img, creator_pos)
            if caption_surf is not None and caption_pos is not None:
                self.screen.blit(caption_surf, caption_pos)

            # 🛑 Error overlay
            if error_message:
                self._draw_error_overlay(error_message)

            pygame.display.flip()
            await asyncio.sleep(0)
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
    async def run(self) -> None:
        # 1) Show menu to pick timer & board size
        await self._show_start_menu()

        # 2) Apply settings
        t = self.settings["timer"]
        rows, cols = self.settings["board_size"]
        special = self.settings.get("special_count", 5)
        # rebuild config with chosen board size
        self.cfg = GameConfig(ROWS=rows, COLS=cols, SPECIAL_COUNT=special)
        # (re)compute responsive layout + reload assets
        self._apply_responsive_layout(force=True)
        self.board  = Board(self.cfg)
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
                    await self._on_click(ev.pos)
            self._draw()
            self.clock.tick(60)
            await asyncio.sleep(0)
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
        player = AssaltoRealeApp.players[self.current_player]
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
    async def _on_click(self, pos: Tuple[int, int]) -> None:
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
        # Map screen pixels -> board cell, accounting for responsive layout offset
        if not self.board_grid_rect.collidepoint(x, y):
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
        # 1) parse everything
        settings, special_sqs, transform_sqs, placements, moves = self._parse_game_file(filename)
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

    # =========================== placement phase ===================== #
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

        if self.turn_pieces_count >= self.turn_sequence[self.turn_index]:
            self._switch_player()
        if sum(self.pieces_placed.values()) == 26:
            self.placing = False

    # =========================== move phase ========================== #
    async def _handle_move_click(self, pos: Vec2) -> None:
        r, c = pos
        if self.selected:
            await self._attempt_move(self.selected, pos)
        else:
            piece = self.board[r][c]
            if piece and piece.player == AssaltoRealeApp.players[self.current_player]:
                self.selected = pos

    async def _attempt_move(self, start: Vec2, end: Vec2) -> None:
        piece = self.board[start[0]][start[1]]
        self.last_move = (start, end)
        if not piece:
            self.selected = None
            return
        if piece.type == "King" and self.king_moved:
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
                await self._animate_king_attack(end)
                self.assets.shield_sound.play()

                def_piece = copy.deepcopy(self.board[defender[0]][defender[1]])

                # ── qui aggiorniamo il contatore ──
                self.board.captured_pieces[def_piece.player]["DefensePawn"] += 1

                path   = self.board.repulse_attack_pawn_path(start, end)
                newpos = await self._animate_repulsion(path, piece)
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
                await self._animate_king_attack(end)
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
        await self._animate_slide(start, end, piece)

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
        if piece.type == "King":
            self.king_moved = True
            move_cost = 1
        else:
            move_cost = 1 if (captured is None or delta == 1) else 2
        self.moves_this_turn += move_cost
        if self.moves_this_turn >= 2:
            self._switch_player()
        self.selected = None

        # se siamo su una casella di trasformazione
        if end in self.board.transform_squares and piece.type in ("AttackPawn","DefensePawn","ConquestPawn"):
            await self._prompt_transformation(end, piece)

    # ============================= bookkeeping ======================= #
    def _switch_player(self) -> None:
        self.current_player = 1 - self.current_player
        self.turn_index = min(self.turn_index + 1,
                              len(self.turn_sequence) - 1)
        self.turn_pieces_count = 0
        self.moves_this_turn = 0
        self.king_moved = False

        self._last_tick = pygame.time.get_ticks()

        # --- turn counter / pending‑win logic -----------------------
        self.turn_counter += 1
        if self.turn_counter >= 30 and not self.board.transform_squares:
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

    def _draw(self) -> None:
        # Keep layout in sync with the current window size
        self._apply_responsive_layout()

        valid: List[Vec2] = []
        if self.selected:
            piece = self.board[self.selected[0]][self.selected[1]]
            if piece:
                valid = self._compute_valid_moves(piece, self.selected)

        # Draw board onto offscreen surface (origin at 0,0)
        draw_board(self.board, self.board_surface, self.font, self.selected, valid, cfg=self.cfg, assets=self.assets)

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

        # Compose: board + HUD
        self.screen.fill(self.cfg.GRAY)
        self.screen.blit(self.board_surface, self.board_surf_rect.topleft)
        self._draw_hud()
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
                            player = piece.player

                            old_square = next(iter(self.board.transform_squares), None) if self.board.transform_squares else None

                            # Apply transformation
                            self.board.grid[pos[0]][pos[1]] = Piece.create(new_type, player)

                            # Move transform square
                            self.board.move_transform_square()
                            new_square = next(iter(self.board.transform_squares), None) if self.board.transform_squares else None

                            # Attach to last move for undo
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
            s = pygame.font.Font(None, max(18, int(self.cfg.SQ_SIZE * 0.34)))
            b = sum(int(v) for v in self.board.captured_pieces.get("Black", {}).values())
            w_ = sum(int(v) for v in self.board.captured_pieces.get("White", {}).values())
            lbl = s.render(f"Captured — Black: {b} | White: {w_}", True, cfg.WHITE)
            bg = pygame.Surface((lbl.get_width() + 16, lbl.get_height() + 10), pygame.SRCALPHA)
            bg.fill((30, 30, 30, 180))
            self.screen.blit(bg, (x0, y0 - (lbl.get_height() + 10)))
            self.screen.blit(lbl, (x0 + 8, y0 - (lbl.get_height() + 5)))
            return

        # Draw into a panel surface so nothing leaks outside its bounds.
        panel = pygame.Surface((w, h), pygame.SRCALPHA)
        panel.fill((30, 30, 30, 160))
        pygame.draw.rect(panel, (0, 0, 0), (0, 0, w, h), 2, border_radius=10)

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

    async def _animate_repulsion(
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


    # ======================== helpers =============================== #
    def _compute_valid_moves(self, piece: Piece, pos: Vec2) -> List[Vec2]:
        if piece.type == "King" and self.king_moved:
            return []
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

            # disegna tutto tranne il pezzo in movimento
            draw_board(self.board, self.screen, self.font, self.selected, [], cfg=self.cfg, assets=self.assets)
            # disegna il pezzo “flottante”
            rect = img.get_rect(center=(cx, cy))
            self.screen.blit(img, rect)
            self._draw_hud()
            pygame.display.flip()

            if t >= 1.0:
                break
            clock.tick(60)
