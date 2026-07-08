import { create } from "zustand";

export interface UiSettings {
  reducedMotion: boolean;
  highContrastBoard: boolean;
}

interface UiSettingsStore extends UiSettings {
  setReducedMotion: (value: boolean) => void;
  setHighContrastBoard: (value: boolean) => void;
  load: () => void;
}

const STORAGE_KEY = "assalto-reale-ui-settings";

const DEFAULT_UI_SETTINGS: UiSettings = {
  reducedMotion: false,
  highContrastBoard: false,
};

function readSettings(): UiSettings {
  if (typeof window === "undefined") return DEFAULT_UI_SETTINGS;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "");
    return {
      reducedMotion: Boolean(parsed?.reducedMotion),
      highContrastBoard: Boolean(parsed?.highContrastBoard),
    };
  } catch {
    return DEFAULT_UI_SETTINGS;
  }
}

function writeSettings(settings: UiSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export const useUiSettings = create<UiSettingsStore>((set, get) => ({
  ...DEFAULT_UI_SETTINGS,
  load: () => set(readSettings()),
  setReducedMotion: (reducedMotion) => {
    const next = { ...get(), reducedMotion };
    writeSettings({ reducedMotion: next.reducedMotion, highContrastBoard: next.highContrastBoard });
    set({ reducedMotion });
  },
  setHighContrastBoard: (highContrastBoard) => {
    const next = { ...get(), highContrastBoard };
    writeSettings({ reducedMotion: next.reducedMotion, highContrastBoard: next.highContrastBoard });
    set({ highContrastBoard });
  },
}));
