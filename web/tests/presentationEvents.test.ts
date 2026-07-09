import { describe, expect, it } from "vitest";
import { derivePresentationEvents, type PresentationSnapshot } from "../src/audio/presentationEvents";

const base: PresentationSnapshot = {
  phase: "playing",
  currentPlayer: "Black",
  capturedTotal: 0,
  movesThisTurn: 0,
  turnCounter: 0,
  selectedKey: null,
  pendingTransform: false,
  pendingDefendedKing: false,
  lastActionKey: "Black to move.",
  humanIsWinner: null,
};

const types = (prev: PresentationSnapshot | null, next: PresentationSnapshot) => derivePresentationEvents(prev, next).map((e) => e.type);

describe("derivePresentationEvents", () => {
  it("emits nothing without a previous snapshot", () => {
    expect(derivePresentationEvents(null, base)).toEqual([]);
  });

  it("emits nothing when nothing changed (no replay)", () => {
    expect(types(base, base)).toEqual([]);
  });

  it("emits select on a new selection", () => {
    expect(types(base, { ...base, selectedKey: "5-5" })).toEqual(["select"]);
  });

  it("emits move for a non-capturing action while playing", () => {
    expect(types(base, { ...base, movesThisTurn: 1, lastActionKey: "Black moved a pawn." })).toEqual(["move"]);
  });

  it("does not emit move for a pass", () => {
    expect(types(base, { ...base, lastActionKey: "Black passed." })).toEqual([]);
  });

  it("emits capture (not move) when the captured total increases", () => {
    expect(types(base, { ...base, capturedTotal: 1, lastActionKey: "Black captured a pawn." })).toEqual(["capture"]);
  });

  it("emits capture then turn when the capture also ends the turn", () => {
    expect(types(base, { ...base, capturedTotal: 1, currentPlayer: "White", lastActionKey: "Black captured a pawn." })).toEqual(["capture", "turn"]);
  });

  it("emits a single sacrifice cue (no duplicate capture) when a defended-King decision appears", () => {
    expect(types(base, { ...base, pendingDefendedKing: true, capturedTotal: 1 })).toEqual(["sacrifice"]);
  });

  it("emits transform when a transform decision appears", () => {
    expect(types(base, { ...base, pendingTransform: true })).toEqual(["transform"]);
  });

  it("emits victory on game over (human-vs-human or human win)", () => {
    expect(types(base, { ...base, phase: "gameOver" })).toEqual(["victory"]);
  });

  it("emits defeat on game over when the human lost", () => {
    expect(types(base, { ...base, phase: "gameOver", humanIsWinner: false })).toEqual(["defeat"]);
  });

  it("assigns increasing sequence ids from seqStart", () => {
    const events = derivePresentationEvents(base, { ...base, capturedTotal: 1, currentPlayer: "White", lastActionKey: "x" }, 10);
    expect(events.map((e) => e.seq)).toEqual([11, 12]);
  });
});
