import type { CrossingEvent, DetectorConfig, DetectorState } from "./types";

/**
 * Edge-triggered threshold detector with hysteresis (a Schmitt trigger).
 *
 * The band [T - h/2, T + h/2] is a dead zone: to switch from below to above the
 * value must rise above the upper edge, and to switch back it must fall below the
 * lower edge. Noise inside the band therefore never produces alternating alerts.
 * With h = 0 this is a plain crossing detector.
 */
export function step(
  state: DetectorState,
  value: number,
  cfg: DetectorConfig,
): [DetectorState, CrossingEvent | null] {
  // A broken reading tells us nothing; keep the last known side.
  if (!Number.isFinite(value)) return [state, null];

  const { threshold, hysteresis } = cfg;

  // First reading: we learn which side we are on, but there was no transition.
  if (state.side === null) return [classify(value, threshold), null];

  // Strict comparisons: a value exactly on a band edge does not switch.
  if (state.side === "below" && value > threshold + hysteresis / 2) {
    return [{ side: "above" }, { direction: "up" }];
  }
  if (state.side === "above" && value < threshold - hysteresis / 2) {
    return [{ side: "below" }, { direction: "down" }];
  }
  return [state, null];
}

/**
 * Silently re-derives the side from a value, without emitting an event.
 * Used on the first reading and whenever the user changes the configuration:
 * a configuration change never raises an alert, only a new reading can (ADR 0003).
 * Classifies against T itself, the same rule as a first reading.
 */
export function classify(
  value: number | undefined,
  threshold: number,
): DetectorState {
  if (value === undefined || !Number.isFinite(value)) return { side: null };
  return { side: value > threshold ? "above" : "below" };
}
