import { createMemoryAlertStore } from "./alertStore";
import { loadConfig, type Config } from "./config";
import { createHttpServer } from "./http";
import { createLogger } from "./logger";
import { attachRelay } from "./relay";

const SHUTDOWN_DEADLINE_MS = 5_000;

let config: Config;
try {
  config = loadConfig(process.env);
} catch (err) {
  // Fail fast: a misconfigured server should not start half working.
  console.error((err as Error).message);
  process.exit(1);
}

const logger = createLogger(config.logLevel);
const store = createMemoryAlertStore(config.recentLimit);
const server = createHttpServer({ staticDir: config.staticDir, logger });
const relay = attachRelay(server, { config, store, logger });

server.on("error", (err) => {
  logger.error("server error", { error: err.message });
  process.exit(1);
});

server.listen(config.port, () => {
  logger.info("listening", {
    port: config.port,
    mode: config.mode,
    staticDir: config.staticDir,
  });
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down", { signal });

  // If something hangs, exit anyway. unref() so this timer alone keeps nothing alive.
  setTimeout(() => {
    logger.error("shutdown deadline exceeded, forcing exit");
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS).unref();

  server.close(); // stop accepting new connections
  await relay.close(); // 1001 "going away" to every client; they reconnect elsewhere
  server.closeAllConnections(); // idle keep-alive HTTP connections
  logger.info("stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
