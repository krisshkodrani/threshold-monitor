import type { Detector, Crossing, SimulationConfig } from "./types";
export function simulatorStep(
  state: Detector,
  value: number,
  cfg: SimulationConfig,
): [Detector, Crossing | null] {
  if (!Number.isFinite(value)) return [state, null];
  if (state.side === null)
    return [{ side: value > cfg.threshold ? "above" : "below" }, null];
  if (state.side === "below" && value > cfg.threshold + cfg.hysteresis / 2)
    return [{ side: "above" }, { direction: "up" }];
  if (state.side === "above" && value < cfg.threshold - cfg.hysteresis / 2)
    return [{ side: "below" }, { direction: "down" }];
  return [state, null];
}
