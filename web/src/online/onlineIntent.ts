import type { ClientCommand } from "./protocol";

/**
 * A create/join command whose authoritative result the client has not yet safely
 * received. It is persisted before the command is sent so that, after a lost
 * response and reconnect, the client can replay the *exact same* command with the
 * *same* commandId and rely on the server's command-receipt idempotency to return
 * the original authoritative result (recovering matchId / side / snapshot).
 *
 * It deliberately holds no canonical match state and no guest token — only the
 * intent to create or join. Exactly one intent is tracked at a time, matching the
 * one-match-at-a-time online model.
 */
export interface PendingLifecycleIntent {
  kind: "create" | "join";
  commandId: string;
  command: ClientCommand;
  createdAt: number;
}

const INTENT_STORAGE_KEY = "assalto:online-intent";

// Match the server's ID_PATTERN so a replayed commandId is always wire-valid.
const COMMAND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;

export function newCommandId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replaceAll("-", "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `command_${random}`.slice(0, 128);
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isValidIntent(value: unknown): value is PendingLifecycleIntent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== "create" && candidate.kind !== "join") return false;
  if (typeof candidate.commandId !== "string" || !COMMAND_ID_PATTERN.test(candidate.commandId)) {
    return false;
  }
  if (typeof candidate.createdAt !== "number" || !Number.isFinite(candidate.createdAt)) {
    return false;
  }
  const command = candidate.command as { type?: unknown } | null;
  if (!command || typeof command !== "object") return false;
  // The persisted command must match the declared intent kind.
  if (candidate.kind === "create") return command.type === "CreateMatch";
  return command.type === "JoinMatch";
}

/** Read the persisted intent, discarding anything corrupt or malformed. */
export function loadPendingIntent(): PendingLifecycleIntent | null {
  const target = storage();
  if (!target) return null;
  try {
    const raw = target.getItem(INTENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidIntent(parsed)) {
      target.removeItem(INTENT_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    try {
      target.removeItem(INTENT_STORAGE_KEY);
    } catch {
      // ignore storage-denied environments
    }
    return null;
  }
}

export function savePendingIntent(intent: PendingLifecycleIntent): void {
  const target = storage();
  if (!target) return;
  try {
    target.setItem(INTENT_STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Recovery is best-effort; a blocked storage must not break the live session.
  }
}

export function clearPendingIntent(): void {
  const target = storage();
  if (!target) return;
  try {
    target.removeItem(INTENT_STORAGE_KEY);
  } catch {
    // ignore storage-denied environments
  }
}
