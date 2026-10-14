import path from "node:path";
import { z } from "zod";

const DEV_ORIGINS = ["http://localhost:5173", "http://localhost:5174"];

// The built apps live next to the server in the repo and in the Docker image:
// <root>/server/dist/index.js (or src/ under tsx) and <root>/apps/*/dist.
const DEFAULT_STATIC_DIR = path.resolve(import.meta.dirname, "../../apps");

// Environment variables are strings; empty strings count as "not set".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const envSchema = z.object({
  PORT: optional(z.coerce.number().int().min(1).max(65535).default(8080)),
  // Production by default, so a forgotten variable fails safe (same origin only).
  NODE_ENV: optional(
    z.enum(["production", "development", "test"]).default("production"),
  ),
  ALLOWED_ORIGINS: optional(z.string().default("")),
  STATIC_DIR: optional(z.string().default(DEFAULT_STATIC_DIR)),
  RECENT_LIMIT: optional(
    z.coerce.number().int().min(1).max(100_000).default(500),
  ),
  LOG_LEVEL: optional(
    z.enum(["debug", "info", "warn", "error"]).default("info"),
  ),
});

export type Config = {
  port: number;
  mode: "production" | "development" | "test";
  allowedOrigins: string[];
  staticDir: string;
  recentLimit: number;
  logLevel: "debug" | "info" | "warn" | "error";
};

/** Parses the environment once at startup. Throws a readable error so the process can fail fast. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    mode: e.NODE_ENV,
    allowedOrigins: e.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    staticDir: path.resolve(e.STATIC_DIR),
    recentLimit: e.RECENT_LIMIT,
    logLevel: e.LOG_LEVEL,
  };
}

/**
 * Browsers do not apply CORS to WebSockets, so any site a user visits could
 * open a socket to this server (cross-site WebSocket hijacking). Checking the
 * Origin header on the upgrade request is the defense.
 *
 * A missing Origin is allowed: browsers always send it, and a non-browser
 * client could send any value it likes, so rejecting it would add no security.
 */
export function isOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  config: Pick<Config, "mode" | "allowedOrigins">,
): boolean {
  if (origin === undefined) return true;
  if (config.allowedOrigins.length > 0)
    return config.allowedOrigins.includes(origin);

  const sameOrigin =
    host !== undefined &&
    (origin === `http://${host}` || origin === `https://${host}`);
  if (sameOrigin) return true;
  return config.mode === "development" && DEV_ORIGINS.includes(origin);
}
