import path from "node:path";
import { describe, expect, test } from "vitest";
import { isOriginAllowed, loadConfig, sensorTokenCheck } from "./config";

describe("loadConfig", () => {
  test("uses safe defaults when nothing is set", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      port: 8080,
      mode: "production",
      allowedOrigins: [],
      logLevel: "info",
    });
    expect(config.staticDir).toBe(
      path.resolve(import.meta.dirname, "../../apps"),
    );
    expect(config).toMatchObject({
      databasePath: path.resolve(
        import.meta.dirname,
        "../../data/threshold-monitor.db",
      ),
      sessionTtlMs: 12 * 60 * 60 * 1000,
      cookieSecure: false,
      demoUsers: false,
      sensorToken: undefined,
    });
  });

  test("treats empty variables as unset", () => {
    expect(loadConfig({ PORT: "", NODE_ENV: "" })).toMatchObject({
      port: 8080,
      mode: "production",
    });
  });

  test("parses every variable", () => {
    const config = loadConfig({
      PORT: "9000",
      NODE_ENV: "development",
      ALLOWED_ORIGINS: " https://a.example , https://b.example ,",
      LOG_LEVEL: "debug",
      DATABASE_PATH: ":memory:",
      SESSION_TTL_HOURS: "1",
      COOKIE_SECURE: "true",
      DEMO_USERS: "1",
    });
    expect(config).toMatchObject({
      databasePath: ":memory:",
      sessionTtlMs: 60 * 60 * 1000,
      cookieSecure: true,
      demoUsers: true,
      port: 9000,
      mode: "development",
      allowedOrigins: ["https://a.example", "https://b.example"],
      logLevel: "debug",
    });
  });

  test.each([
    [{ PORT: "eighty" }, "PORT"],
    [{ PORT: "70000" }, "PORT"],
    [{ NODE_ENV: "staging" }, "NODE_ENV"],
    [{ LOG_LEVEL: "loud" }, "LOG_LEVEL"],
    [{ SESSION_TTL_HOURS: "0" }, "SESSION_TTL_HOURS"],
    [{ COOKIE_SECURE: "maybe" }, "COOKIE_SECURE"],
    [{ SENSOR_TOKEN: "too-short" }, "SENSOR_TOKEN"],
  ])("rejects %j, naming the variable", (env, name) => {
    expect(() => loadConfig(env)).toThrow(
      new RegExp(`Invalid configuration: .*${name}`),
    );
  });
});

describe("isOriginAllowed", () => {
  const production = { mode: "production" as const, allowedOrigins: [] };
  const development = { mode: "development" as const, allowedOrigins: [] };

  test("production allows the same origin, over http or https", () => {
    expect(
      isOriginAllowed("http://localhost:8080", "localhost:8080", production),
    ).toBe(true);
    expect(
      isOriginAllowed("https://monitor.example", "monitor.example", production),
    ).toBe(true);
  });

  test("production rejects other origins, including the Vite dev servers", () => {
    expect(
      isOriginAllowed("https://evil.example", "localhost:8080", production),
    ).toBe(false);
    expect(
      isOriginAllowed("http://localhost:5173", "localhost:8080", production),
    ).toBe(false);
  });

  test("development also allows the Vite dev servers", () => {
    expect(
      isOriginAllowed("http://localhost:5173", "localhost:8080", development),
    ).toBe(true);
    expect(
      isOriginAllowed("http://localhost:5174", "localhost:8080", development),
    ).toBe(true);
    expect(
      isOriginAllowed("http://localhost:3000", "localhost:8080", development),
    ).toBe(false);
  });

  test("an explicit list replaces the defaults", () => {
    const config = {
      mode: "production" as const,
      allowedOrigins: ["https://ops.example"],
    };
    expect(
      isOriginAllowed("https://ops.example", "localhost:8080", config),
    ).toBe(true);
    expect(
      isOriginAllowed("http://localhost:8080", "localhost:8080", config),
    ).toBe(false);
  });

  test("a missing Origin (non-browser client) is allowed", () => {
    expect(isOriginAllowed(undefined, "localhost:8080", production)).toBe(true);
  });
});

describe("sensorTokenCheck", () => {
  test("accepts the exact token only", () => {
    const check = sensorTokenCheck("the-right-sensor-token");
    expect(check("the-right-sensor-token")).toBe(true);
    expect(check("the-right-sensor-tokeN")).toBe(false);
    expect(check("short")).toBe(false);
    expect(check("")).toBe(false);
  });

  test("without SENSOR_TOKEN, no token is accepted", () => {
    expect(sensorTokenCheck(undefined)("anything-at-all-here")).toBe(false);
  });
});
