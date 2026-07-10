"""Shared deterministic PRNG — the Python mirror of web/src/game/engine/random.ts.

Mulberry32 reproduced so the Python reference engine and the TypeScript engine
produce byte-identical seeded output (Special/Transform Square generation). The
canonical contract lives in docs/rules-parity-contract.md.

Implementation notes: JavaScript bit operators work on 32-bit words. We keep
every intermediate as a 32-bit *bit pattern* (masked to 0xFFFFFFFF); the only
place signedness matters is the `value + inner` step, where JS adds the two
values as signed int32s, so we convert to signed there before masking the sum
back to 32 bits.
"""

from __future__ import annotations

import random
from typing import List, Optional, Sequence, TypeVar

_MASK = 0xFFFFFFFF

T = TypeVar("T")


def _to_i32(value: int) -> int:
    value &= _MASK
    return value - 0x100000000 if value & 0x80000000 else value


def _imul(a: int, b: int) -> int:
    # Math.imul: low 32 bits of the 32-bit integer product (bit pattern).
    return (a * b) & _MASK


class Mulberry32:
    """Matches mulberry32(seed) in random.ts exactly."""

    def __init__(self, seed: int) -> None:
        self._state = seed & _MASK

    def random(self) -> float:
        self._state = (self._state + 0x6D2B79F5) & _MASK
        value = self._state
        value = _imul(value ^ (value >> 15), value | 1)
        inner = _imul(value ^ (value >> 7), value | 61)
        s = (_to_i32(value) + _to_i32(inner)) & _MASK
        value = (value ^ s) & _MASK
        out = (value ^ (value >> 14)) & _MASK
        return out / 4294967296.0

    def random_int(self, bound: int) -> int:
        return int(self.random() * bound)


def coerce_seed(seed: Optional[int]) -> int:
    """A concrete unsigned 32-bit seed; None yields a fresh entropy seed so real
    matches stay non-deterministic (seeded reproducibility is opt-in)."""
    if seed is None:
        return random.getrandbits(32)
    return seed & _MASK


def shuffle(items: Sequence[T], rng: Mulberry32) -> List[T]:
    """Fisher-Yates matching shuffle() in random.ts (last index down, one draw)."""
    result = list(items)
    for index in range(len(result) - 1, 0, -1):
        target = rng.random_int(index + 1)
        result[index], result[target] = result[target], result[index]
    return result


def choice(items: Sequence[T], rng: Mulberry32) -> Optional[T]:
    if not items:
        return None
    return items[rng.random_int(len(items))]
