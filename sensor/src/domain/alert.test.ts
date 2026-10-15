import { alertSchema } from "@app/protocol";
import { expect, test } from "vitest";
import { createAlert } from "./alert";

const context = {
  sourceId: "8b2e4d71-0c3f-4a59-b6e8-5d1a9f7c3b02",
  sourceLabel: "Monitor 8B2",
  metric: "temperature",
  unit: "°C",
};

test("builds a protocol-valid alert from a crossing", () => {
  const alert = createAlert(
    "3f0c6a8e-6b1d-4c2a-9f4e-2a7d5b9c1e01",
    { t: Date.UTC(2026, 9, 14, 9, 30), value: 25.42 },
    "up",
    { threshold: 25, hysteresis: 0.6 },
    context,
  );

  expect(alert).toMatchObject({
    value: 25.42,
    threshold: 25,
    hysteresis: 0.6,
    direction: "up",
    eventTime: "2026-10-14T09:30:00.000Z",
    sourceLabel: "Monitor 8B2",
  });
  expect(alertSchema.safeParse(alert).success).toBe(true);
});
