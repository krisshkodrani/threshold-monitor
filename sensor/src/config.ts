import { z } from "zod";

// Environment variables are strings; empty strings count as "not set".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const envSchema = z.object({
  RELAY_URL: optional(
    z.url({ protocol: /^wss?$/ }).default("ws://localhost:8080/ws"),
  ),
  // The relay's SENSOR_TOKEN. Required: without it the relay refuses the sensor.
  SENSOR_TOKEN: z.string().min(16),
  // A fixed id, so alerts and settings stay with the sensor after a restart.
  SENSOR_ID: optional(
    z.uuidv4().default("5d0a2f6e-1c3b-4e7a-9b8d-2f4e6a8c0b13"),
  ),
  SENSOR_LABEL: optional(z.string().min(1).max(60).default("Sensor 1")),
  SENSOR_RATE_HZ: optional(
    z.coerce
      .number()
      .refine((n) => [1, 2, 5, 10].includes(n), "use 1, 2, 5 or 10")
      .default(2),
  ),
  SENSOR_SEED: optional(z.coerce.number().int().min(0).default(20261014)),
  LOG_LEVEL: optional(
    z.enum(["debug", "info", "warn", "error"]).default("info"),
  ),
});

export type SensorConfig = {
  relayUrl: string;
  token: string;
  sensor: { sensorId: string; label: string; rateHz: number };
  seed: number;
  logLevel: "debug" | "info" | "warn" | "error";
};

/** Parses the environment once at start. Throws a readable error, so the process fails fast. */
export function loadConfig(
  env: Record<string, string | undefined>,
): SensorConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const e = parsed.data;
  return {
    relayUrl: e.RELAY_URL,
    token: e.SENSOR_TOKEN,
    sensor: {
      sensorId: e.SENSOR_ID,
      label: e.SENSOR_LABEL,
      rateHz: e.SENSOR_RATE_HZ,
    },
    seed: e.SENSOR_SEED,
    logLevel: e.LOG_LEVEL,
  };
}

/** Everything specific to "temperature". The detector only knows a generic value. */
export const metric = { key: "temperature", unit: "°C" } as const;

/** The settings the sensor starts with when the relay has none stored. */
export const defaultSettings = { threshold: 25, hysteresis: 0.6 } as const;
