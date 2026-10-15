import type { Alert } from "@app/protocol";

/** A valid alert for tests; the ids may be anything the test needs. */
export function testAlert(id: string, overrides: Partial<Alert> = {}): Alert {
  return {
    id,
    sourceId: "source-1",
    sourceLabel: "Sensor TST",
    metric: "temperature",
    unit: "°C",
    threshold: 25,
    hysteresis: 0.6,
    value: 25.5,
    direction: "up",
    eventTime: "2026-10-14T09:30:00.000Z",
    ...overrides,
  };
}
