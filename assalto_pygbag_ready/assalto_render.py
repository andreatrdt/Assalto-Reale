from __future__ import annotations

from typing import List, Optional

import pygame

from assalto_core import Board, GameConfig, Vec2
from assalto_assets import AssetLoader

def draw_board(
    board: Board,
    surface: pygame.Surface,
    font: pygame.font.Font,
    selected: Optional[Vec2] = None,
    valid_moves: Optional[List[Vec2]] = None,
    *,
    cfg: GameConfig,
    assets: AssetLoader,
) -> None:
    """Render the board + pieces + highlights.

    Kept as a standalone function so the core engine (Board/Pieces) stays pygame-free.
    """
    surface.fill(cfg.GRAY)

    # --- squares ---------------------------------------------------------
    for r in range(cfg.ROWS):
        for c in range(cfg.COLS):
            base = cfg.LIGHT_BROWN if (r + c) % 2 == 0 else cfg.DARK_BROWN
            pygame.draw.rect(surface, base, (c * cfg.SQ_SIZE, r * cfg.SQ_SIZE, cfg.SQ_SIZE, cfg.SQ_SIZE))

    # --- special squares -------------------------------------------------
    for r, c in board.special_squares:
        pygame.draw.circle(
            surface,
            cfg.GREEN,
            (c * cfg.SQ_SIZE + cfg.SQ_SIZE // 2, r * cfg.SQ_SIZE + cfg.SQ_SIZE // 2),
            cfg.SQ_SIZE // 3 + 5,
        )



    # --- transform squares (icon) ---------------------------------------
    for r, c in board.transform_squares:
        icon = assets.transform_icon
        x = c * cfg.SQ_SIZE + cfg.SQ_SIZE // 2
        y = r * cfg.SQ_SIZE + cfg.SQ_SIZE // 2
        rect = icon.get_rect(center=(x, y))
        surface.blit(icon, rect)

    # --- pieces ----------------------------------------------------------
    for r in range(cfg.ROWS):
        for c in range(cfg.COLS):
            piece = board.grid[r][c]
            if piece:
                img = assets.piece_images[piece.player][piece.type]
                rect = img.get_rect(center=(c * cfg.SQ_SIZE + cfg.SQ_SIZE // 2, r * cfg.SQ_SIZE + cfg.SQ_SIZE // 2))
                surface.blit(img, rect)

    # --- highlights ------------------------------------------------------
    if selected and valid_moves:
        for r, c in valid_moves:
            target = board.grid[r][c]
            colour = cfg.RED_HIGHLIGHT if target else cfg.HIGHLIGHT
            pygame.draw.circle(
                surface,
                colour,
                (c * cfg.SQ_SIZE + cfg.SQ_SIZE // 2, r * cfg.SQ_SIZE + cfg.SQ_SIZE // 2),
                cfg.SQ_SIZE // 6,
            )

    # --- board coordinates ----------------------------------------------
    margin = 10
    num_x = cfg.COLS * cfg.SQ_SIZE + margin
    for r in range(cfg.ROWS):
        lbl = font.render(str(cfg.ROWS - r), True, cfg.BLACK)
        y   = r * cfg.SQ_SIZE + (cfg.SQ_SIZE // 2) - (lbl.get_height() // 2)
        surface.blit(lbl, (num_x, y))

    file_y = cfg.ROWS * cfg.SQ_SIZE + margin
    for c in range(cfg.COLS):
        lbl = font.render(chr(ord("A") + c), True, cfg.BLACK)
        x   = c * cfg.SQ_SIZE + (cfg.SQ_SIZE // 2) - (lbl.get_width() // 2)
        surface.blit(lbl, (x, file_y))
