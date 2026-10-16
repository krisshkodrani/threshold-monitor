export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type Logger = Record<
  LogLevel,
  (msg: string, fields?: LogFields) => void
>;

const order: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Structured JSON lines on stdout, one event per line, so a log collector can
 * parse them. Callers log ids and counts, never whole message payloads.
 */
export function createLogger(
  level: LogLevel,
  write: (line: string) => void = (line) => console.log(line),
): Logger {
  const log =
    (at: LogLevel) =>
    (msg: string, fields: LogFields = {}) => {
      if (order[at] < order[level]) return;
      write(
        JSON.stringify({
          time: new Date().toISOString(),
          level: at,
          msg,
          ...fields,
        }),
      );
    };
  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
  };
}

/** For tests: swallows everything. */
export const silentLogger: Logger = createLogger("error", () => {});

/** The part of `process` that logFatalErrors uses, so tests can pass a fake. */
export type FatalErrorSource = {
  on(event: "uncaughtException", listener: (err: Error) => void): unknown;
  on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
  exit(code: number): never;
};

/**
 * Without this, a bug stops the process with a stack trace on stderr and no
 * JSON log line. The handler logs the error, then stops with code 1: the
 * state can be broken, and Docker starts a new process.
 */
export function logFatalErrors(
  logger: Logger,
  source: FatalErrorSource = process,
) {
  const fail = (msg: string, error: unknown) => {
    logger.error(msg, {
      error:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    source.exit(1);
  };
  source.on("uncaughtException", (err) => fail("uncaught exception", err));
  source.on("unhandledRejection", (reason) =>
    fail("unhandled rejection", reason),
  );
}
