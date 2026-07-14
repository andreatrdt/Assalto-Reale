import { describe, expect, it } from "vitest";
import {
  GAME_RULES_VERSION,
  REPLAY_SCHEMA_VERSION,
  replayHistoricalMatch,
  serializeState,
} from "@assalto-reale/game-core";

function event(
  sequenceNumber: number,
  actorSide: "Black" | "White",
  command: { type: "PassTurn" } | { type: "Resign" },
) {
  return {
    sequenceNumber,
    actorSide,
    payload: { schemaVersion: REPLAY_SCHEMA_VERSION, command },
  };
}

const base = {
  rulesVersion: GAME_RULES_VERSION,
  replaySchemaVersion: REPLAY_SCHEMA_VERSION,
  seed: 42,
  placementMode: "QuickBalanced" as const,
  transformEnabled: false,
};

describe("versioned game-core history replay", () => {
  it("accepts resignation from the participant who is not currently moving", () => {
    const replay = replayHistoricalMatch({
      ...base,
      events: [event(1, "White", { type: "Resign" })],
    });

    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.frames.at(-1)?.terminal).toEqual({
        winner: "Black",
        loser: "White",
        reason: "resignation",
      });
    }
  });

  it("reconstructs accepted commands and exposes deterministic frames", () => {
    const first = replayHistoricalMatch({
      ...base,
      events: [
        event(1, "Black", { type: "PassTurn" }),
        event(2, "White", { type: "Resign" }),
      ],
    });
    const second = replayHistoricalMatch({
      ...base,
      events: [
        event(1, "Black", { type: "PassTurn" }),
        event(2, "White", { type: "Resign" }),
      ],
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.frames).toHaveLength(3);
    expect(first.frames[2]?.terminal).toEqual({
      winner: "Black",
      loser: "White",
      reason: "resignation",
    });
    expect(serializeState(first.frames[1]!.state)).toBe(
      serializeState(second.frames[1]!.state),
    );
  });

  it("fails clearly for unsupported versions", () => {
    expect(
      replayHistoricalMatch({ ...base, rulesVersion: 999, events: [] }),
    ).toMatchObject({
      ok: false,
      code: "unsupported_rules_version",
    });
    expect(
      replayHistoricalMatch({ ...base, replaySchemaVersion: 999, events: [] }),
    ).toMatchObject({
      ok: false,
      code: "unsupported_replay_schema",
    });
  });

  it("rejects gaps, invalid actors, and commands after resignation", () => {
    expect(
      replayHistoricalMatch({
        ...base,
        events: [event(2, "Black", { type: "PassTurn" })],
      }),
    ).toMatchObject({
      ok: false,
      code: "invalid_replay",
    });
    expect(
      replayHistoricalMatch({
        ...base,
        events: [event(1, "White", { type: "PassTurn" })],
      }),
    ).toMatchObject({
      ok: false,
      code: "invalid_replay",
    });
    expect(
      replayHistoricalMatch({
        ...base,
        events: [
          event(1, "Black", { type: "Resign" }),
          event(2, "White", { type: "PassTurn" }),
        ],
      }),
    ).toMatchObject({ ok: false, code: "invalid_replay" });
  });
});
