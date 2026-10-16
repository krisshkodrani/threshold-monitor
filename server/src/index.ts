import { createSqliteAlertStore } from "./alertStore";
import { loadConfig, sensorTokenCheck, type Config } from "./config";
import { openDatabase } from "./db";
import { createHttpServer } from "./http";
import { createLogger, logFatalErrors } from "./logger";
import { attachRelay } from "./relay";
import { authenticate, createSessionStore } from "./sessions";
import { loadOrCreateSensorToken } from "./sensorTokenFile";
import { createSqliteSettingsStore } from "./settingsStore";
import { addDemoUsers, createUserStore } from "./users";

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
logFatalErrors(logger);
const db = openDatabase(config.databasePath);
const store = createSqliteAlertStore(db);
const users = createUserStore(db);
const sessions = createSessionStore(db, { ttlMs: config.sessionTtlMs });
if (config.demoUsers) {
  const added = await addDemoUsers(users);
  logger.warn("demo users are enabled; do not use this in production", {
    added,
  });
}
let shuttingDown = false;

/** Ready while the database answers and the server does not stop. */
function isReady() {
  if (shuttingDown) return false;
  try {
    db.prepare("SELECT 1").get();
    return true;
  } catch {
    return false;
  }
}

const server = createHttpServer({
  staticDir: config.staticDir,
  logger,
  isReady,
  auth: {
    users,
    sessions,
    config,
    onLogout: (sessionId) => relay.closeSession(sessionId),
  },
});
let sensorToken = config.sensorToken;
if (!sensorToken && config.sensorTokenFile) {
  const loaded = loadOrCreateSensorToken(config.sensorTokenFile);
  sensorToken = loaded.token;
  // The file name only, never the token.
  logger.info(loaded.created ? "sensor token created" : "sensor token read", {
    file: config.sensorTokenFile,
  });
}
if (!sensorToken) logger.warn("SENSOR_TOKEN is not set; no sensor can connect");
const relay = attachRelay(server, {
  config,
  store,
  settings: createSqliteSettingsStore(db),
  isSensorToken: sensorTokenCheck(sensorToken),
  logger,
  authenticate: (req) => authenticate(req, sessions),
  isSessionActive: (sessionId) => sessions.isActive(sessionId),
});

server.on("error", (err) => {
  logger.error("server error", { error: err.message });
  process.exit(1);
});

server.listen(config.port, () => {
  logger.info("listening", {
    port: config.port,
    mode: config.mode,
    staticDir: config.staticDir,
    databasePath: config.databasePath,
  });
});

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
  db.close();
  logger.info("stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
