import type {
  SimulationState,
  Side,
  SimulationConfig,
  Crossing,
} from "./types";
import { simTemperature } from "./format";
export function simDecision(
  simulation: SimulationState,
  before: Side,
  value: number,
  cfg: SimulationConfig,
  event: Crossing | null,
) {
  const lower = cfg.threshold - cfg.hysteresis / 2,
    upper = cfg.threshold + cfg.hysteresis / 2;
  if (before === null)
    return `First reading: ${simTemperature(value)} establishes “${simulation.detector.side}” relative to ${simTemperature(cfg.threshold)}. There is no previous side to cross from, so no alert.`;
  if (event)
    return `${simTemperature(value)} is strictly ${event.direction === "up" ? "above the upper" : "below the lower"} edge of ${simTemperature(event.direction === "up" ? upper : lower)}. The detector changes from ${before} to ${simulation.detector.side} and creates one ${event.direction} alert.`;
  if (
    (before === "below" && value === upper) ||
    (before === "above" && value === lower)
  )
    return `Exactly on the ${before === "below" ? "upper" : "lower"} edge (${simTemperature(value)}): no crossing. Comparisons are strict; the detector stays ${before}.`;
  return `${simTemperature(value)} does not ${before === "below" ? "exceed the upper" : "fall below the lower"} edge of ${simTemperature(before === "below" ? upper : lower)}. The detector remembers “${before}”; no alert is created.`;
}
