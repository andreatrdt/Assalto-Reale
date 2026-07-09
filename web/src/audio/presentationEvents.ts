// Presentation-event derivation. This layer observes the *resulting* store state
// (which already reflects accepted canonical actions) and derives sequenced
// presentation events. It never mutates engine or store state, and it is a pure
// function of two snapshots so it can be unit-tested deterministically.
import type { Player } from "../game/engine";
import type { SoundName } from "./audioService";

export interface PresentationSnapshot {
  phase: string;
  currentPlayer: Player;
  capturedTotal: number;
  movesThisTurn: number;
  turnCounter: number;
  selectedKey: string | null;
  pendingTransform: boolean;
  pendingDefendedKing: boolean;
  lastActionKey: string;
  /** null when not applicable (e.g. human-vs-human or not game over). */
  humanIsWinner: boolean | null;
}

export type PresentationEventType = "select" | "move" | "capture" | "sacrifice" | "transform" | "turn" | "victory" | "defeat";

export interface PresentationEvent {
  seq: number;
  type: PresentationEventType;
}

const NON_MOVE_MARKERS = ["pass", "saved", "loaded", "wins"];

/**
 * Returns the presentation events implied by the transition prev -> next.
 * `seq` is a monotonically increasing id supplied by the caller so consumers can
 * ignore already-processed events after a rerender.
 */
export function derivePresentationEvents(prev: PresentationSnapshot | null, next: PresentationSnapshot, seqStart = 0): PresentationEvent[] {
  if (!prev) return [];
  const out: PresentationEventType[] = [];

  if (next.selectedKey && next.selectedKey !== prev.selectedKey) out.push("select");

  const defenderJustAppeared = next.pendingDefendedKing && !prev.pendingDefendedKing;
  if (defenderJustAppeared) out.push("sacrifice");

  if (next.pendingTransform && !prev.pendingTransform) out.push("transform");

  const captured = next.capturedTotal > prev.capturedTotal;
  // The defended-King cue already covers its own sacrifice sound.
  if (captured && !defenderJustAppeared) out.push("capture");

  const actionChanged = next.lastActionKey !== prev.lastActionKey;
  const isMoveMessage = !NON_MOVE_MARKERS.some((m) => next.lastActionKey.toLowerCase().includes(m));
  if (!captured && actionChanged && next.phase === "playing" && isMoveMessage) out.push("move");

  if (next.phase === "playing" && next.currentPlayer !== prev.currentPlayer) out.push("turn");

  if (next.phase === "gameOver" && prev.phase !== "gameOver") {
    out.push(next.humanIsWinner === false ? "defeat" : "victory");
  }

  return out.map((type, index) => ({ seq: seqStart + index + 1, type }));
}

export function soundForEvent(type: PresentationEventType): SoundName {
  return type;
}
