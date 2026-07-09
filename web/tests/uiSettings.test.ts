import { beforeEach, describe, expect, it } from "vitest";
import { useUiSettings } from "../src/ui/uiSettings";

const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
};

beforeEach(() => {
  store.clear();
  useUiSettings.setState({ reducedMotion: false, highContrastBoard: false, soundEnabled: true, volume: 0.6 });
});

describe("uiSettings audio preferences", () => {
  it("clamps volume into [0,1]", () => {
    useUiSettings.getState().setVolume(2);
    expect(useUiSettings.getState().volume).toBe(1);
    useUiSettings.getState().setVolume(-1);
    expect(useUiSettings.getState().volume).toBe(0);
  });

  it("persists sound + volume and reloads them", () => {
    useUiSettings.getState().setSoundEnabled(false);
    useUiSettings.getState().setVolume(0.3);
    // Simulate a reload by resetting in-memory state and loading from storage.
    useUiSettings.setState({ soundEnabled: true, volume: 0.6 });
    useUiSettings.getState().load();
    expect(useUiSettings.getState().soundEnabled).toBe(false);
    expect(useUiSettings.getState().volume).toBe(0.3);
  });

  it("defaults sound on and volume 0.6 for settings saved before audio existed", () => {
    store.set("assalto-reale-ui-settings", JSON.stringify({ reducedMotion: true, highContrastBoard: false }));
    useUiSettings.getState().load();
    const state = useUiSettings.getState();
    expect(state.reducedMotion).toBe(true);
    expect(state.soundEnabled).toBe(true);
    expect(state.volume).toBe(0.6);
  });
});
