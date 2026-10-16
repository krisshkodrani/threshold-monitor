import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { loadOrCreateSensorToken } from "./sensorTokenFile";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sensor-token-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("the first start makes a token that only this user can read", () => {
  const file = path.join(dir, "secrets", "sensor-token");
  const { token, created } = loadOrCreateSensorToken(file);
  expect(created).toBe(true);
  expect(token).toMatch(/^[0-9a-f]{48}$/);
  expect(readFileSync(file, "utf8")).toBe(`${token}\n`);
  expect(statSync(file).mode & 0o777).toBe(0o600);
});

test("later starts read the same token", () => {
  const file = path.join(dir, "sensor-token");
  const first = loadOrCreateSensorToken(file);
  const second = loadOrCreateSensorToken(file);
  expect(second).toEqual({ token: first.token, created: false });
});

test("a token written by a person is used, without spaces", () => {
  const file = path.join(dir, "sensor-token");
  writeFileSync(file, "  my-own-token-0123456789 \n");
  expect(loadOrCreateSensorToken(file)).toEqual({
    token: "my-own-token-0123456789",
    created: false,
  });
});

test("a token that is too short stops the start", () => {
  const file = path.join(dir, "sensor-token");
  writeFileSync(file, "short\n");
  expect(() => loadOrCreateSensorToken(file)).toThrow(
    /shorter than 16 characters/,
  );
});
