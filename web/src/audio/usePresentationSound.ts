import { useEffect, useRef } from "react";
import { useGameStore } from "../game/state/gameStore";
import { audioService } from "./audioService";
import { derivePresentationEvents, soundForEvent, type PresentationSnapshot } from "./presentationEvents";

type StoreState = ReturnType<typeof useGameStore.getState>;

function capturedTotal(state: StoreState): number {
  const captured = state.board.capturedPieces;
  let total = 0;
  for (const player of Object.keys(captured) as Array<keyof typeof captured>) {
    for (const count of Object.values(captured[player])) total += count as number;
  }
  return total;
}

export function toPresentationSnapshot(state: StoreState): PresentationSnapshot {
  const phase = state.phase.phase;
  let humanIsWinner: boolean | null = null;
  if (phase === "gameOver" && state.aiEnabled) {
    const winner = state.message.split(" ")[0];
    const humanSide = state.matchConfig?.resolvedHumanSide ?? null;
    humanIsWinner = humanSide ? winner === humanSide : null;
  }
  return {
    phase,
    currentPlayer: state.currentPlayer,
    capturedTotal: capturedTotal(state),
    movesThisTurn: state.movesThisTurn,
    turnCounter: state.turnCounter,
    selectedKey: state.selected ? `${state.selected[0]}-${state.selected[1]}` : null,
    pendingTransform: state.pendingTransform !== null,
    pendingDefendedKing: state.pendingDefendedKing !== null,
    lastActionKey: state.lastAction,
    humanIsWinner,
  };
}

/**
 * Subscribes to the game store and plays sounds for derived presentation events.
 * Fully decoupled from the engine: it only reads resulting state and calls the
 * audio service. Cancels its subscription on unmount, and uses a sequence id so a
 * rerender cannot replay already-processed events.
 */
export function usePresentationSound(): void {
  const prevRef = useRef<PresentationSnapshot | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    prevRef.current = toPresentationSnapshot(useGameStore.getState());
    let active = true;

    const unsubscribe = useGameStore.subscribe((state) => {
      if (!active) return;
      const next = toPresentationSnapshot(state);
      const events = derivePresentationEvents(prevRef.current, next, seqRef.current);
      prevRef.current = next;
      if (events.length === 0) return;
      seqRef.current = events[events.length - 1].seq;
      for (const event of events) audioService.play(soundForEvent(event.type));
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
}
