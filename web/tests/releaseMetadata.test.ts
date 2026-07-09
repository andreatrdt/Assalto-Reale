import { describe, expect, it } from "vitest";
import { buildReleaseMetadata } from "../scripts/releaseMetadata.mjs";

const now = () => new Date("2026-07-09T00:00:00.000Z");

describe("buildReleaseMetadata", () => {
  it("records the tested commit, preferring SOURCE_COMMIT over GITHUB_SHA", () => {
    const meta = buildReleaseMetadata(
      { SOURCE_COMMIT: "1b34a8f7b26dab64528a44dcaad451273ba6a61a", GITHUB_SHA: "deadbeef", GITHUB_REPOSITORY: "andreatrdt/Assalto-Reale" },
      { version: "0.1.0", now },
    );

    expect(meta.commit).toBe("1b34a8f7b26dab64528a44dcaad451273ba6a61a");
    expect(meta.repository).toBe("andreatrdt/Assalto-Reale");
    expect(meta.version).toBe("0.1.0");
    expect(meta.application).toBe("Assalto Reale React web client");
    expect(meta.builtAt).toBe("2026-07-09T00:00:00.000Z");
  });

  it("falls back to GITHUB_SHA when SOURCE_COMMIT is absent (guards workflow_run's default-branch SHA)", () => {
    const meta = buildReleaseMetadata({ GITHUB_SHA: "deadbeef" }, { version: "0.1.0", now });
    expect(meta.commit).toBe("deadbeef");
  });

  it("defaults repository and marks the commit unknown when nothing is provided", () => {
    const meta = buildReleaseMetadata({}, { version: "0.1.0", now });
    expect(meta.repository).toBe("andreatrdt/Assalto-Reale");
    expect(meta.commit).toBe("unknown");
  });
});
