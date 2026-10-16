import { EventEmitter } from "node:events";
import { expect, test, vi } from "vitest";
import { createLogger, logFatalErrors, type FatalErrorSource } from "./logger";

function setup() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger("info", (line) =>
    lines.push(JSON.parse(line) as Record<string, unknown>),
  );
  const emitter = new EventEmitter();
  const exit = vi.fn();
  const source = Object.assign(emitter, {
    exit,
  }) as unknown as FatalErrorSource;
  logFatalErrors(logger, source);
  return { lines, emitter, exit };
}

test("an uncaught exception is logged as JSON, then the process stops with 1", () => {
  const { lines, emitter, exit } = setup();
  emitter.emit("uncaughtException", new Error("boom"));
  expect(lines).toEqual([
    expect.objectContaining({
      level: "error",
      msg: "uncaught exception",
      error: expect.stringContaining("Error: boom") as unknown,
    }),
  ]);
  expect(exit).toHaveBeenCalledWith(1);
});

test("an unhandled rejection with a non-Error reason is logged too", () => {
  const { lines, emitter, exit } = setup();
  emitter.emit("unhandledRejection", "no reason");
  expect(lines).toEqual([
    expect.objectContaining({
      msg: "unhandled rejection",
      error: "no reason",
    }),
  ]);
  expect(exit).toHaveBeenCalledWith(1);
});
