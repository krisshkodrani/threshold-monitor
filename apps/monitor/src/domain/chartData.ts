import type { DetectorConfig, Direction, Reading } from "./types";

/** A crossing to draw, keyed by the time of the reading that caused it. */
export type ChartMarker = { t: number; direction: Direction };

export type ChartRow = {
  /** Seconds relative to the newest reading: 0 is "now", -30 is 30 s ago. */
  t: number;
  value: number;
  marker?: Direction;
};

export type ChartData = {
  rows: ChartRow[];
  threshold: number;
  band: { upper: number; lower: number };
  /** Y axis range, always including the band so the threshold stays visible. */
  domain: [number, number];
  /** X axis ticks in seconds (<= 0) on round values, ending at 0 ("now"). */
  timeTicks: number[];
};

/** Minimum padding above and below the data, in value units. */
const MIN_PADDING = 1;
const PADDING_RATIO = 0.1;
/** Tick spacings in seconds; the smallest giving at most MAX_INTERVALS wins. */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300];
const MAX_INTERVALS = 6;

/**
 * Everything the chart needs, precomputed so the chart component only renders.
 * Time is relative to the newest reading rather than a clock, which keeps this
 * pure and makes the X axis read "now" at the right edge.
 */
export function toChartData(
  readings: readonly Reading[],
  markers: readonly ChartMarker[],
  cfg: DetectorConfig,
): ChartData {
  const band = {
    upper: cfg.threshold + cfg.hysteresis / 2,
    lower: cfg.threshold - cfg.hysteresis / 2,
  };

  const newest = readings.at(-1)?.t ?? 0;
  const markerAt = new Map(markers.map((m) => [m.t, m.direction]));
  // Markers whose reading has left the window find no row and are dropped.
  const rows = readings.map((r): ChartRow => {
    const marker = markerAt.get(r.t);
    return {
      t: (r.t - newest) / 1000,
      value: r.value,
      ...(marker ? { marker } : {}),
    };
  });

  const values = readings.map((r) => r.value);
  const low = Math.min(band.lower, ...values);
  const high = Math.max(band.upper, ...values);
  const padding = Math.max(MIN_PADDING, (high - low) * PADDING_RATIO);
  // Rounding outward to whole units keeps the axis still while values move
  // inside it; it only changes when the data needs more room.
  const domain: [number, number] = [
    Math.floor(low - padding),
    Math.ceil(high + padding),
  ];

  const timeTicks = roundTicks(rows[0]?.t ?? 0);
  return { rows, threshold: cfg.threshold, band, domain, timeTicks };
}

/** 0, -step, -2*step ... back to the oldest reading, so labels read "−5 s", not "−4.901 s". */
function roundTicks(oldest: number): number[] {
  const step = TICK_STEPS.find((s) => -oldest / s <= MAX_INTERVALS) ?? 300;
  const ticks: number[] = [];
  for (let t = 0; t >= oldest; t -= step) ticks.unshift(t);
  return ticks;
}
