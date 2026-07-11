import { describe, expect, it } from "vitest";
import { createJsonLogger } from "../src/logger.js";

describe("structured JSON logger", () => {
  it("emits one JSON record per line with level filtering", () => {
    const lines: string[] = [];
    const logger = createJsonLogger({
      level: "info",
      service: "test",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      write: (line) => lines.push(line),
    });

    logger.debug("hidden below threshold");
    logger.info("started", { port: 8080 });
    logger.warn("degraded");
    logger.error("boom", { code: "E1" });

    expect(lines).toHaveLength(3);
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(first).toMatchObject({
      level: "info",
      service: "test",
      message: "started",
      port: 8080,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    expect(JSON.parse(lines[2]!)).toMatchObject({ level: "error", code: "E1" });
  });

  it("defaults to info level and stdout", () => {
    const lines: string[] = [];
    const logger = createJsonLogger({ write: (line) => lines.push(line) });
    logger.debug("nope");
    logger.info("yes");
    expect(lines).toHaveLength(1);
  });
});
