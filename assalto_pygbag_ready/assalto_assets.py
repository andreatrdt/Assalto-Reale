from __future__ import annotations

import os
from typing import Dict, Optional

import pygame

from assalto_core import GameConfig

class _NullSound:
    def play(self) -> None:
        return

class AssetLoader:
    """Loads and scales PNG sprites and audio (when available).

    Notes for web (pygbag):
    - pygame.mixer may be unavailable or restricted; we fall back to no-op sounds.
    - Call this AFTER pygame.init() and pygame.display.set_mode() for best results.
    """

    def __init__(self, cfg: GameConfig):
        self.cfg = cfg

        # --- audio (optional) ---------------------------------------------
        self._audio_ok = False
        try:
            if not pygame.mixer.get_init():
                pygame.mixer.init()
            self._audio_ok = True
        except Exception:
            self._audio_ok = False

        self.move_sound   = self._load_sound("move_chess.wav")
        self.capture_sound = self._load_sound("attack_chess.wav")
        self.shield_sound = self._load_sound("shield_chess.ogg")

        # --- piece sprites -------------------------------------------------
        self.piece_images: Dict[str, Dict[str, pygame.Surface]] = {}
        self._load_piece_images()

        # --- transform square icon ----------------------------------------
        raw = pygame.image.load(os.path.join(self.cfg.ASSETS_DIR, "transform_square.png")).convert_alpha()
        size = max(8, cfg.SQ_SIZE // 2)
        self.transform_icon = pygame.transform.smoothscale(raw, (size, size))

    def _load_sound(self, filename: str):
        if not self._audio_ok:
            return _NullSound()
        try:
            return pygame.mixer.Sound(os.path.join(self.cfg.ASSETS_DIR, filename))
        except Exception:
            return _NullSound()

    def _load_piece_images(self) -> None:
        piece_defs = {
            "Black": ["attack_pawn", "defense_pawn", "conquest_pawn", "king"],
            "White": ["attack_pawn", "defense_pawn", "conquest_pawn", "king"],
        }
        for colour, names in piece_defs.items():
            self.piece_images[colour] = {}
            for name in names:
                raw = pygame.image.load(os.path.join(self.cfg.ASSETS_DIR, f"{colour.lower()}_{name}.png")).convert_alpha()
                raw = pygame.transform.smoothscale(raw, (2 * self.cfg.SQ_SIZE // 3, 2 * self.cfg.SQ_SIZE // 3))
                key = {
                    "attack_pawn": "AttackPawn",
                    "defense_pawn": "DefensePawn",
                    "conquest_pawn": "ConquestPawn",
                    "king": "King",
                }[name]
                self.piece_images[colour][key] = raw
