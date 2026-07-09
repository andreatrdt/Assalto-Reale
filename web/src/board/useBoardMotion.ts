import { useEffect, useRef, useState } from "react";
import { useGameStore } from "../game/state/gameStore";
import {
  deriveBoardMotion,
  motionDuration,
  type BoardMotionDraft,
  type BoardMotionEvent,
  type BoardMotionSnapshot,
} from "./boardMotion";

type StoreState = ReturnType<typeof useGameStore.getState>;
type DefendedKingContext = NonNullable<BoardMotionSnapshot["pendingDefendedKing"]>;

export function toBoardMotionSnapshot(state: StoreState): BoardMotionSnapshot {
  return {
    board: state.board,
    phase: state.phase.phase,
    lastAction: state.lastAction,
    message: state.message,
    placementCursor: state.placementCursor,
    historyLength: state.history.length,
    pendingTransform: state.pendingTransform
      ? { pos: state.pendingTransform.pos, pieceType: state.pendingTransform.pieceType }
      : null,
    pendingDefendedKing: state.pendingDefendedKing
      ? {
          action: state.pendingDefendedKing.action as DefendedKingContext["action"],
          defenders: state.pendingDefendedKing.defenders,
        }
      : null,
  };
}

export interface BoardMotionController {
  motion: BoardMotionEvent | null;
  isAnimating: boolean;
  cancelMotion: () => void;
}

/**
 * Presentation-only queue for board transitions. Store actions remain synchronous
 * and authoritative; this controller merely hides/replays the visual delta.
 */
export function useBoardMotion(reducedMotion: boolean): BoardMotionController {
  const [motion, setMotion] = useState<BoardMotionEvent | null>(null);
  const previousRef = useRef<BoardMotionSnapshot | null>(null);
  const activeRef = useRef<BoardMotionEvent | null>(null);
  const queueRef = useRef<BoardMotionDraft[]>([]);
  const sequenceRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(reducedMotion);
  const cancelRef = useRef<() => void>(() => undefined);

  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    let mounted = true;
    previousRef.current = toBoardMotionSnapshot(useGameStore.getState());

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const cancelAll = () => {
      clearTimer();
      queueRef.current = [];
      activeRef.current = null;
      if (mounted) setMotion(null);
    };
    cancelRef.current = cancelAll;

    const startNext = () => {
      if (!mounted || activeRef.current || queueRef.current.length === 0) return;
      const draft = queueRef.current.shift();
      if (!draft) return;

      const event: BoardMotionEvent = {
        ...draft,
        id: sequenceRef.current + 1,
        durationMs: motionDuration(draft.kind, reducedMotionRef.current),
        reducedMotion: reducedMotionRef.current,
      };
      sequenceRef.current = event.id;
      activeRef.current = event;
      setMotion(event);

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        activeRef.current = null;
        if (!mounted) return;
        setMotion(null);
        startNext();
      }, event.durationMs);
    };

    const unsubscribe = useGameStore.subscribe((state) => {
      if (!mounted) return;
      const next = toBoardMotionSnapshot(state);
      const derivation = deriveBoardMotion(previousRef.current, next);
      previousRef.current = next;

      if (derivation.reset) {
        cancelAll();
        return;
      }
      if (!derivation.event) return;

      // Keep the queue deliberately short. Normal AI pacing is slower than the
      // standard animation; this cap prevents stale visual work after unusual
      // rapid state restoration or test fixtures.
      if (queueRef.current.length >= 3) queueRef.current.shift();
      queueRef.current.push(derivation.event);
      startNext();
    });

    return () => {
      mounted = false;
      unsubscribe();
      clearTimer();
      queueRef.current = [];
      activeRef.current = null;
      cancelRef.current = () => undefined;
    };
  }, []);

  useEffect(() => {
    // Changing to reduced motion should never leave a translation running. The
    // authoritative board is revealed immediately; subsequent events use the
    // short reduced-motion presentation.
    if (reducedMotion) cancelRef.current();
  }, [reducedMotion]);

  return {
    motion,
    isAnimating: motion !== null,
    cancelMotion: () => cancelRef.current(),
  };
}
