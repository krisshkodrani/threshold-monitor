import { expect, test } from "vitest";
import { loadConfig } from "./config";

const TOKEN = "test-sensor-token-0123456789";
const noFile = () => {
  throw new Error("ENOENT: no such file");
};

test("SENSOR_TOKEN is used as it is", () => {
  expect(loadConfig({ SENSOR_TOKEN: TOKEN }, noFile).token).toBe(TOKEN);
});

test("without SENSOR_TOKEN, the token comes from SENSOR_TOKEN_FILE", () => {
  const config = loadConfig(
    { SENSOR_TOKEN_FILE: "/app/data/sensor-token" },
    (file) => (file === "/app/data/sensor-token" ? `${TOKEN}\n` : ""),
  );
  expect(config.token).toBe(TOKEN);
});

test("SENSOR_TOKEN has priority over the file", () => {
  const config = loadConfig(
    { SENSOR_TOKEN: TOKEN, SENSOR_TOKEN_FILE: "/app/data/sensor-token" },
    () => "another-token-from-the-file",
  );
  expect(config.token).toBe(TOKEN);
});

test.each([
  [{}, /set SENSOR_TOKEN or SENSOR_TOKEN_FILE/],
  [{ SENSOR_TOKEN_FILE: "/missing" }, /cannot read SENSOR_TOKEN_FILE/],
  [{ SENSOR_TOKEN: "short" }, /SENSOR_TOKEN/],
])("a missing or bad token stops the start: %o", (env, message) => {
  expect(() => loadConfig(env, noFile)).toThrow(message);
});

test("a token file that is too short stops the start", () => {
  expect(() =>
    loadConfig({ SENSOR_TOKEN_FILE: "/app/data/sensor-token" }, () => "short"),
  ).toThrow(/shorter than 16 characters/);
});
