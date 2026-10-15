import { describe, expect, test } from "vitest";
import { step } from "./crossing";
import { createRandomWalk } from "./randomWalk";
import { mulberry32 } from "./rng";
import type { DetectorState } from "./types";

function take(next: () => number, count: number): number[] {
  return Array.from({ length: count }, next);
}

describe("mulberry32", () => {
  test("returns values in [0, 1) and repeats for the same seed", () => {
    const values = take(mulberry32(7), 1000);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(take(mulberry32(7), 1000)).toEqual(values);
  });
});

describe("createRandomWalk", () => {
  test("the same seed produces the same sequence", () => {
    expect(take(createRandomWalk({ seed: 123 }), 500)).toEqual(
      take(createRandomWalk({ seed: 123 }), 500),
    );
  });

  test("different seeds produce different sequences", () => {
    expect(take(createRandomWalk({ seed: 1 }), 50)).not.toEqual(
      take(createRandomWalk({ seed: 2 }), 50),
    );
  });

  test("values are rounded to two decimals", () => {
    for (const value of take(createRandomWalk({ seed: 5 }), 200)) {
      expect(Math.round(value * 100) / 100).toBe(value);
    }
  });

  test("starts near the given start value", () => {
    const [first] = take(createRandomWalk({ seed: 9, start: 10 }), 1);
    expect(first).toBeGreaterThan(8);
    expect(first).toBeLessThan(13);
  });

  test.each([1, 42, 123, 2026])(
    "stays within 15..35 for 100 000 steps (seed %i)",
    (seed) => {
      const next = createRandomWalk({ seed });
      for (let i = 0; i < 100_000; i++) {
        const value = next();
        if (value < 15 || value > 35)
          throw new Error(`step ${i}: ${value} out of band`);
      }
    },
  );

  test("crosses the default threshold with default hysteresis regularly", () => {
    // Default app settings: threshold 25, hysteresis 0.6. 1 000 steps = ~8 minutes at 2 Hz.
    const cfg = { threshold: 25, hysteresis: 0.6 };
    let state: DetectorState = { side: null };
    let alerts = 0;
    for (const value of take(createRandomWalk({ seed: 123 }), 1000)) {
      const [next, event] = step(state, value, cfg);
      state = next;
      if (event) alerts++;
    }
    expect(alerts).toBeGreaterThanOrEqual(5);
  });
});
