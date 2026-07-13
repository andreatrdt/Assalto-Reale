import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearPendingIntent, loadPendingIntent, newCommandId, savePendingIntent, type PendingLifecycleIntent } from "./onlineIntent";

const KEY = "assalto:online-intent";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const CREATE_INTENT: PendingLifecycleIntent = {
  kind: "create",
  commandId: "command_create0001",
  command: {
    type: "CreateMatch",
    config: {
      visibility: "invite",
      placementMode: "Manual",
      transformEnabled: true,
      preferredSide: "Random",
      timeControl: { kind: "untimed" },
    },
  },
  createdAt: 1_700_000_000_000,
};

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { sessionStorage: memoryStorage() };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("pending lifecycle intent persistence", () => {
  it("round-trips a valid create intent", () => {
    savePendingIntent(CREATE_INTENT);
    expect(loadPendingIntent()).toEqual(CREATE_INTENT);
  });

  it("returns null and clears storage for a corrupt entry", () => {
    window.sessionStorage.setItem(KEY, "{not valid json");
    expect(loadPendingIntent()).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("rejects a structurally invalid intent (kind/payload mismatch) and clears it", () => {
    // kind says "join" but the payload is a CreateMatch: a tampered/stale entry.
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...CREATE_INTENT, kind: "join" }));
    expect(loadPendingIntent()).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("rejects an intent whose commandId is not wire-valid", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...CREATE_INTENT, commandId: "bad id!" }));
    expect(loadPendingIntent()).toBeNull();
  });

  it("clears the persisted intent", () => {
    savePendingIntent(CREATE_INTENT);
    clearPendingIntent();
    expect(loadPendingIntent()).toBeNull();
  });

  it("generates wire-valid command ids", () => {
    const id = newCommandId();
    expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/);
  });
});
