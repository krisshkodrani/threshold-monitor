import { startAgent } from "./agent";
import {
  defaultSettings,
  loadConfig,
  metric,
  type SensorConfig,
} from "./config";
import { createRandomWalkSource } from "./data/randomWalkSource";
import { createLogger } from "./logger";
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

function shutdown(signal: string) {
  logger.info("stopping", { signal });
  agent.stop();
  transport.dispose();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
