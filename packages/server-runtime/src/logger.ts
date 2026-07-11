import type { TransportLogger } from "@assalto-reale/server-transport";

// Minimal structured JSON logger. It emits one JSON object per line so logs are
// machine-parseable in any container platform. Secrets are never passed to it;
// the runtime deliberately keeps the guest-session secret out of every log call.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface RuntimeLogger extends TransportLogger {
  debug(message: string, context?: Record<string, unknown>): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  level?: LogLevel;
  service?: string;
  now?: () => Date;
  write?: (line: string) => void;
}

export function createJsonLogger(options: LoggerOptions = {}): RuntimeLogger {
  const threshold = LEVEL_ORDER[options.level ?? "info"];
  const service = options.service ?? "multiplayer-server";
  const now = options.now ?? (() => new Date());
  const write = options.write ?? ((line) => process.stdout.write(`${line}\n`));

  function emit(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < threshold) return;
    const record: Record<string, unknown> = {
      timestamp: now().toISOString(),
      level,
      service,
      message,
      ...(context ?? {}),
    };
    write(JSON.stringify(record));
  }

  return {
    debug: (message, context) => emit("debug", message, context),
    info: (message, context) => emit("info", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, context) => emit("error", message, context),
  };
}
