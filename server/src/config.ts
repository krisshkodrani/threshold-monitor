import path from "node:path";
import { z } from "zod";

const DEV_ORIGINS = ["http://localhost:5173", "http://localhost:5174"];

// The built apps live next to the server in the repo and in the Docker image:
// <root>/server/dist/index.js (or src/ under tsx) and <root>/apps/*/dist.
const DEFAULT_STATIC_DIR = path.resolve(import.meta.dirname, "../../apps");
// The same way: <root>/data, which is a volume in Docker.
const DEFAULT_DATABASE_PATH = path.resolve(
  import.meta.dirname,
  "../../data/threshold-monitor.db",
);

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
  LOG_LEVEL: optional(
    z.enum(["debug", "info", "warn", "error"]).default("info"),
  ),
  DATABASE_PATH: optional(z.string().default(DEFAULT_DATABASE_PATH)),
  SESSION_TTL_HOURS: optional(
    z.coerce
      .number()
      .positive()
      .max(24 * 30)
      .default(12),
  ),
  // Off by default, so plain http://localhost works; set it behind TLS.
  COOKIE_SECURE: optional(z.stringbool().default(false)),
  // Adds the demo users "operator", "monitor" and "demo" (password "demo") at start.
  DEMO_USERS: optional(z.stringbool().default(false)),
});

export type Config = {
  port: number;
  mode: "production" | "development" | "test";
  allowedOrigins: string[];
  staticDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
  databasePath: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
  demoUsers: boolean;
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
    logLevel: e.LOG_LEVEL,
    databasePath:
      e.DATABASE_PATH === ":memory:"
        ? e.DATABASE_PATH
        : path.resolve(e.DATABASE_PATH),
    sessionTtlMs: e.SESSION_TTL_HOURS * 60 * 60 * 1000,
    cookieSecure: e.COOKIE_SECURE,
    demoUsers: e.DEMO_USERS,
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
