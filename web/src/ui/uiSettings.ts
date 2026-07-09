import { create } from "zustand";
import { clampVolume } from "../audio/audioService";

export interface UiSettings {
  reducedMotion: boolean;
  highContrastBoard: boolean;
  soundEnabled: boolean;
  volume: number;
}

interface UiSettingsStore extends UiSettings {
  setReducedMotion: (value: boolean) => void;
  setHighContrastBoard: (value: boolean) => void;
  setSoundEnabled: (value: boolean) => void;
  setVolume: (value: number) => void;
  load: () => void;
}

const STORAGE_KEY = "assalto-reale-ui-settings";

const DEFAULT_UI_SETTINGS: UiSettings = {
  reducedMotion: false,
  highContrastBoard: false,
  soundEnabled: true,
  volume: 0.6,
};

function readSettings(): UiSettings {
  if (typeof window === "undefined") return DEFAULT_UI_SETTINGS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "");
    return {
      reducedMotion: Boolean(parsed?.reducedMotion),
      highContrastBoard: Boolean(parsed?.highContrastBoard),
      // Default to enabled when absent (settings saved before audio existed).
      soundEnabled: parsed?.soundEnabled === undefined ? true : Boolean(parsed.soundEnabled),
      volume: parsed?.volume === undefined ? DEFAULT_UI_SETTINGS.volume : clampVolume(Number(parsed.volume)),
    };
  } catch {
    return DEFAULT_UI_SETTINGS;
  }
}

function snapshot(state: UiSettings): UiSettings {
  return {
    reducedMotion: state.reducedMotion,
    highContrastBoard: state.highContrastBoard,
    soundEnabled: state.soundEnabled,
    volume: state.volume,
  };
}

function writeSettings(settings: UiSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const useUiSettings = create<UiSettingsStore>((set, get) => ({
  ...DEFAULT_UI_SETTINGS,
  load: () => set(readSettings()),
  setReducedMotion: (reducedMotion) => {
    set({ reducedMotion });
    writeSettings(snapshot(get()));
  },
  setHighContrastBoard: (highContrastBoard) => {
    set({ highContrastBoard });
    writeSettings(snapshot(get()));
  },
  setSoundEnabled: (soundEnabled) => {
    set({ soundEnabled });
    writeSettings(snapshot(get()));
  },
  setVolume: (value) => {
    set({ volume: clampVolume(value) });
    writeSettings(snapshot(get()));
  },
}));
