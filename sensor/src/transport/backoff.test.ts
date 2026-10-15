import { describe, expect, test } from "vitest";
import { backoffDelay, MAX_DELAY_MS } from "./backoff";

const lowest = () => 0;
const highest = () => 0.999999;

describe("backoffDelay", () => {
  test("doubles with each attempt", () => {
    const upper = [0, 1, 2, 3, 4].map((attempt) =>
      backoffDelay(attempt, () => 1),
    );
    expect(upper).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  test("is capped at 30 seconds", () => {
    expect(backoffDelay(6, () => 1)).toBe(MAX_DELAY_MS);
    expect(backoffDelay(50, () => 1)).toBe(MAX_DELAY_MS);
  });

  test("jitter keeps the delay between half and all of the capped value", () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const capped = Math.min(MAX_DELAY_MS, 500 * 2 ** attempt);
      expect(backoffDelay(attempt, lowest)).toBe(capped / 2);
      expect(backoffDelay(attempt, highest)).toBeLessThan(capped);
      expect(backoffDelay(attempt, highest)).toBeGreaterThan(capped / 2);
    }
  });

  test("stays finite and capped for absurd attempt counts", () => {
    expect(backoffDelay(10_000, () => 1)).toBe(MAX_DELAY_MS);
    expect(backoffDelay(-5, () => 1)).toBe(500);
  });
});
