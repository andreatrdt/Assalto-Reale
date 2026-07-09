import { describe, expect, it } from "vitest";
import { audioService, clampVolume, shouldPlay, SOUND_SPECS, type SoundName } from "../src/audio/audioService";

const ALL_SOUNDS: SoundName[] = ["select", "move", "capture", "sacrifice", "transform", "turn", "victory", "defeat", "confirm"];

describe("clampVolume", () => {
  it("clamps to [0,1] and coerces invalid values to 0", () => {
    expect(clampVolume(0.6)).toBe(0.6);
    expect(clampVolume(2)).toBe(1);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(Number.NaN)).toBe(0);
  });
});

describe("shouldPlay", () => {
  it("blocks when muted or volume is zero", () => {
    expect(shouldPlay({ muted: true, volume: 1, now: 100 })).toBe(false);
    expect(shouldPlay({ muted: false, volume: 0, now: 100 })).toBe(false);
  });

  it("plays when unmuted with volume and no recent duplicate", () => {
    expect(shouldPlay({ muted: false, volume: 0.5, now: 100 })).toBe(true);
  });

  it("suppresses rapid duplicates within the minimum gap", () => {
    expect(shouldPlay({ muted: false, volume: 0.5, lastAt: 100, now: 130, minGapMs: 55 })).toBe(false);
    expect(shouldPlay({ muted: false, volume: 0.5, lastAt: 100, now: 200, minGapMs: 55 })).toBe(true);
  });
});

describe("SOUND_SPECS", () => {
  it("defines a short, low-gain tone for every sound category", () => {
    for (const name of ALL_SOUNDS) {
      const spec = SOUND_SPECS[name];
      expect(spec).toBeDefined();
      expect(spec.duration).toBeGreaterThan(0);
      expect(spec.duration).toBeLessThanOrEqual(0.6);
      expect(spec.gain).toBeGreaterThan(0);
      expect(spec.gain).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("audioService", () => {
  it("clamps volume and reports state", () => {
    audioService.setVolume(5);
    expect(audioService.getState().volume).toBe(1);
    audioService.setVolume(0.4);
    audioService.setMuted(true);
    expect(audioService.getState()).toEqual({ muted: true, volume: 0.4 });
  });

  it("fails silently and creates no oscillator when muted", () => {
    let created = 0;
    audioService._setContextFactory(() => makeMockContext(() => (created += 1)));
    audioService.setMuted(true);
    audioService.setVolume(0.6);
    audioService.play("move");
    expect(created).toBe(0);
  });

  it("synthesizes a tone when unmuted, and dedupes rapid duplicates", () => {
    let created = 0;
    audioService._setContextFactory(() => makeMockContext(() => (created += 1)));
    audioService.setMuted(false);
    audioService.setVolume(0.6);
    audioService.play("victory");
    audioService.play("victory"); // immediate duplicate -> suppressed
    expect(created).toBe(1);
  });

  it("never throws when audio is unavailable", () => {
    audioService._setContextFactory(() => null);
    audioService.setMuted(false);
    audioService.setVolume(0.6);
    expect(() => audioService.play("capture")).not.toThrow();
  });
});

function makeMockContext(onOscillator: () => void): AudioContext {
  const node = {
    connect: () => node,
    disconnect: () => undefined,
    start: () => undefined,
    stop: () => undefined,
    frequency: { setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined },
    gain: { setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
    type: "sine",
    onended: null,
  };
  return {
    currentTime: 0,
    state: "running",
    resume: () => Promise.resolve(),
    createOscillator: () => {
      onOscillator();
      return node as unknown as OscillatorNode;
    },
    createGain: () => node as unknown as GainNode,
    destination: {} as AudioDestinationNode,
  } as unknown as AudioContext;
}
