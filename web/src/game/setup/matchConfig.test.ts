import { describe, expect, it } from "vitest";
import { DEFAULT_MATCH_CONFIG, createPublicMatchConfig } from "./matchConfig";

describe("createPublicMatchConfig", () => {
  it("always forces manual placement and Transform for public matches", () => {
    const config = createPublicMatchConfig({ opponent: "Human", humanSide: "Black", timerSeconds: 600 });

    expect(config.placementMode).toBe("Manual");
    expect(config.transformEnabled).toBe(true);
  });

  it("carries the chosen opponent, side and timer", () => {
    const config = createPublicMatchConfig({ opponent: "Computer", humanSide: "Random", timerSeconds: 300 });

    expect(config.opponent).toBe("Computer");
    expect(config.humanSide).toBe("Random");
    expect(config.timerSeconds).toBe(300);
  });

  it("keeps AI difficulty configured internally even though it is hidden publicly", () => {
    const config = createPublicMatchConfig({ opponent: "Computer", humanSide: "White", timerSeconds: 720 });

    expect(config.aiDifficulty).toBe(DEFAULT_MATCH_CONFIG.aiDifficulty);
    expect(["Easy", "Medium", "Hard"]).toContain(config.aiDifficulty);
  });
});
