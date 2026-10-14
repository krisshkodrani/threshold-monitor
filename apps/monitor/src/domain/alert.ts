import type { Alert } from "@app/protocol";
import type { DetectorConfig, Direction, Reading } from "./types";

export type AlertContext = {
  sourceId: string;
  sourceLabel: string;
  metric: string;
  unit: string;
};

/**
 * Builds the alert for a crossing. The id is passed in (rather than generated
 * here) so this stays pure and tests can assert on the exact output.
 */
export function createAlert(
  id: string,
  reading: Reading,
  direction: Direction,
  cfg: DetectorConfig,
  context: AlertContext,
): Alert {
  return {
    id,
    ...context,
    threshold: cfg.threshold,
    hysteresis: cfg.hysteresis,
    value: reading.value,
    direction,
    eventTime: new Date(reading.t).toISOString(),
  };
}
