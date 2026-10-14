import { expect, test } from "vitest";
import { defaults } from "./config";
import { readLaunchOptions } from "./launchOptions";

test("reads seed and rate from the query string", () => {
  expect(readLaunchOptions("?seed=123&rate=10")).toEqual({
    seed: 123,
    rateHz: 10,
  });
});

test("falls back to defaults when parameters are missing", () => {
  expect(readLaunchOptions("")).toEqual({
    seed: defaults.seed,
    rateHz: defaults.rateHz,
  });
});

test.each(["?seed=abc&rate=3", "?seed=1.5&rate=-1", "?seed=&rate="])(
  "ignores invalid values in %s",
  (search) => {
    expect(readLaunchOptions(search)).toEqual({
      seed: defaults.seed,
      rateHz: defaults.rateHz,
    });
  },
);
