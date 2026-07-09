import { describe, expect, it } from "vitest";
import { describeOutcome } from "../src/pages/victoryOutcome";

describe("describeOutcome", () => {
  it("formats a king-capture win", () => {
    expect(describeOutcome("White wins by king_capture.")).toEqual({
      winner: "White",
      reasonKey: "king_capture",
      sentence: "White wins by capturing the King.",
    });
  });

  it("formats a territory win", () => {
    const out = describeOutcome("Black wins by territory.");
    expect(out.winner).toBe("Black");
    expect(out.reasonKey).toBe("territory");
    expect(out.sentence).toBe("Black wins by controlling the Special Squares.");
  });

  it("formats a timeout win", () => {
    const out = describeOutcome("White wins by timeout.");
    expect(out.reasonKey).toBe("timeout");
    expect(out.sentence).toBe("White wins on time.");
  });
});
