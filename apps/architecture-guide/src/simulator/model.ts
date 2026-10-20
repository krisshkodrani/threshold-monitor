import type { SimulationConfig, SimulationState } from "./types";
export const simulationPresets: Record<string, SimulationConfig> = {
  crossings: {
    threshold: 25,
    hysteresis: 0.6,
    readings: [24, 25.1, 25.3, 25.4, 25.1, 24.7, 24.6],
  },
  noise: {
    threshold: 25,
    hysteresis: 0.6,
    readings: [24.9, 25.1, 24.8, 25.2, 24.9, 25.1],
  },
  zero: {
    threshold: 25,
    hysteresis: 0,
    readings: [24.9, 25.1, 24.9, 25.1],
  },
};
simulationPresets.edges = {
  threshold: 25,
  hysteresis: 0.6,
  readings: [24, 25.3, 25.4, 24.7, 24.6],
};
simulationPresets.initial = {
  threshold: 25,
  hysteresis: 0.6,
  readings: [26, 26.2, 25.1, 24.6],
};
simulationPresets.configure = {
  threshold: 25,
  hysteresis: 0.6,
  readings: [24, 24.8, 24.5, 23.6],
};
simulationPresets.hysteresis = {
  threshold: 25,
  hysteresis: 0.6,
  readings: [24.9, 25.2, 25.15, 24.85, 25.15],
};
export const simulationSettingsChanges: Record<
  string,
  {
    settings: { threshold: number; hysteresis: number };
    label: string;
    requestTitle: string;
    receivedReason: string;
  }
> = {
  configure: {
    settings: { threshold: 24, hysteresis: 0.6 },
    label: "threshold 24°C",
    requestTitle: "Monitor requests a lower threshold: 25°C → 24°C",
    receivedReason:
      "Before the next measurement, the agent will silently reclassify its previous 24.8°C reading against the new 24°C threshold. Changing configuration alone cannot create a crossing alert (ADR 0003). Chart bands now show the new settings.",
  },
  hysteresis: {
    settings: { threshold: 25, hysteresis: 0.2 },
    label: "hysteresis 0.2°C",
    requestTitle: "Monitor narrows the hysteresis band: 0.6°C → 0.2°C",
    receivedReason:
      "The band narrows from 24.7–25.3°C to 24.9–25.1°C; the threshold stays 25°C. Configuration alone creates no alert. Before reading #3, the agent silently reclassifies the previous 25.2°C reading as above. The later 24.85°C reading crosses the new lower edge, although it was inside the old band.",
  },
};
export const SIM_EPOCH = Date.parse("2026-10-19T12:00:00Z");
export const SIM_SENSOR = "5d0a2f6e-1c3b-4e7a-9b8d-2f4e6a8c0b13";

export function newSimulation(config: SimulationConfig): SimulationState {
  return {
    config,
    scenario: null,
    settingsPhase: 0,
    settingsChanged: false,
    reclassifyOnReading: false,
    started: false,
    index: 0,
    phase: 0,
    detector: { side: null },
    previous: null,
    current: null,
    samples: [],
    pending: [],
    relayReadings: [],
    relayAlerts: [],
    monitorReadings: [],
    monitorAlerts: [],
    controlAlerts: [],
    events: [],
    clock: SIM_EPOCH,
    alertCount: 0,
    ack: null,
    messageJourney: null,
    active: null,
    status: "Ready to explore",
    title: "What will the next number do?",
    reason:
      "The first sample establishes the detector state. It never creates an alert. Press Step to advance one stage at a time.",
  };
}
