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
};

/** Minimum padding above and below the data, in value units. */
const MIN_PADDING = 1;
const PADDING_RATIO = 0.1;

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

  return { rows, threshold: cfg.threshold, band, domain };
}
