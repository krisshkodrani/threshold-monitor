import { describe, expect, test } from "vitest";
import { toChartData } from "./chartData";
import type { Reading } from "./types";

const cfg = { threshold: 25, hysteresis: 0.6 };
const T0 = 1_760_000_000_000;

/** Readings every 500 ms (2 Hz) with the given values. */
function readings(...values: number[]): Reading[] {
  return values.map((value, i) => ({ t: T0 + i * 500, value }));
}

describe("toChartData", () => {
  test("time is in seconds relative to the newest reading", () => {
    const { rows } = toChartData(readings(24, 24.5, 25), [], cfg);
    expect(rows.map((r) => r.t)).toEqual([-1, -0.5, 0]);
    expect(rows.map((r) => r.value)).toEqual([24, 24.5, 25]);
  });

  test("attaches markers to the reading that caused them", () => {
    const { rows } = toChartData(
      readings(24, 25.5, 25, 24.5),
      [
        { t: T0 + 500, direction: "up" },
        { t: T0 + 1500, direction: "down" },
      ],
      cfg,
    );
    expect(rows.map((r) => r.marker)).toEqual([
      undefined,
      "up",
      undefined,
      "down",
    ]);
    // No marker key at all on unmarked rows, not `marker: undefined`.
    expect("marker" in rows[0]!).toBe(false);
  });

  test("drops markers whose reading is no longer in the window", () => {
    const { rows } = toChartData(
      readings(24, 25),
      [{ t: T0 - 500, direction: "up" }],
      cfg,
    );
    expect(rows.some((r) => r.marker)).toBe(false);
  });

  test("returns the threshold and the hysteresis band", () => {
    const data = toChartData(readings(24), [], cfg);
    expect(data.threshold).toBe(25);
    expect(data.band.upper).toBeCloseTo(25.3);
    expect(data.band.lower).toBeCloseTo(24.7);
  });

  test("the domain covers the values, padded and rounded outward to whole units", () => {
    // Values span 23.2..26.4 (3.2 wide), so padding is the 1 unit minimum.
    expect(toChartData(readings(23.2, 26.4), [], cfg).domain).toEqual([22, 28]);
    // A 20 unit span gets 10 % padding (2 units).
    expect(toChartData(readings(10, 30), [], cfg).domain).toEqual([8, 32]);
  });

  test("the domain always includes the band, even when all values are far away", () => {
    const [min, max] = toChartData(readings(10, 11), [], cfg).domain;
    expect(min).toBeLessThanOrEqual(10);
    expect(max).toBeGreaterThanOrEqual(25.3);
  });

  test("the domain stays the same while values move inside it", () => {
    const a = toChartData(readings(24.1, 25.6), [], cfg).domain;
    const b = toChartData(readings(24.3, 25.2), [], cfg).domain;
    expect(a).toEqual(b);
  });

  test("time ticks sit on round seconds and end at now", () => {
    // 25 readings at 2 Hz span 12 s; a 2 s step gives 6 intervals.
    const values = Array.from({ length: 25 }, () => 24);
    expect(toChartData(readings(...values), [], cfg).timeTicks).toEqual([
      -12, -10, -8, -6, -4, -2, 0,
    ]);
    // 241 readings span 120 s: a 30 s step keeps it readable.
    const long = Array.from({ length: 241 }, () => 24);
    expect(toChartData(readings(...long), [], cfg).timeTicks).toEqual([
      -120, -90, -60, -30, 0,
    ]);
  });

  test("with no readings there are no rows and the domain frames the band", () => {
    const data = toChartData([], [], cfg);
    expect(data.rows).toEqual([]);
    expect(data.domain).toEqual([23, 27]);
  });
});
