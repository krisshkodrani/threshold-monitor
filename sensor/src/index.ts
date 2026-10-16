import { startAgent } from "./agent";
import {
  defaultSettings,
  loadConfig,
  metric,
  type SensorConfig,
} from "./config";
import { createRandomWalkSource } from "./data/randomWalkSource";
import { createLogger, logFatalErrors } from "./logger";
import { createWebSocketTransport } from "./transport/websocketTransport";

let config: SensorConfig;
try {
  config = loadConfig(process.env);
} catch (err) {
  // Fail fast: a sensor without a token or with a bad URL cannot work.
  console.error((err as Error).message);
  process.exit(1);
}

const logger = createLogger(config.logLevel);
logFatalErrors(logger);
const transport = createWebSocketTransport({
  url: config.relayUrl,
  sensor: config.sensor,
  token: config.token,
  log: (message, detail) => logger.warn(message, { detail }),
});
const source = createRandomWalkSource({
  seed: config.seed,
  rateHz: config.sensor.rateHz,
});
const agent = startAgent({
  source,
  transport,
  sensor: config.sensor,
  metric,
  defaults: defaultSettings,
  onAlert: (direction, value) => logger.info("crossing", { direction, value }),
});

transport.onStatus((status) => {
  logger.info("relay connection", { status: status.kind });
  if (status.kind === "unauthorized") {
    logger.error("the relay refused SENSOR_TOKEN; stopping");
    process.exit(1);
  }
});
transport.onDelivery((update) => {
  if (update.status === "dropped")
    logger.warn("alert dropped, outbox full", { alertId: update.alertId });
});

logger.info("sensor started", {
  relayUrl: config.relayUrl,
  ...config.sensor,
});

/** How long a stop waits for the relay to accept the queued alerts. */
const DRAIN_MS = 3_000;

let stopping = false;

async function shutdown(signal: string) {
  // A second signal during the drain stops at once.
  if (stopping) process.exit(1);
  stopping = true;
  logger.info("stopping", { signal });
  agent.stop(); // no new readings or alerts
  // The outbox is in memory only: give the queued alerts a short time.
  const lost = await transport.drain(DRAIN_MS);
  if (lost > 0) logger.warn("alerts not delivered at stop", { count: lost });
  transport.dispose();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
