import { act, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { createReadingsStore } from "../data/readingsStore";
import type { AlertCounts } from "../store/alertsSlice";
import { ReadoutBar } from "./ReadoutBar";

const counts: AlertCounts = {
  total: 7,
  queued: 1,
  sent: 2,
  accepted: 3,
  acknowledged: 1,
  dropped: 0,
};

/** The <dd> value next to a <dt> label. */
function valueOf(label: string) {
  return screen.getByText(label).nextElementSibling?.textContent;
}

test("shows placeholders before the first reading", () => {
  render(
    <ReadoutBar
      readings={createReadingsStore(10)}
      threshold={25}
      side={null}
      counts={counts}
    />,
  );
  expect(valueOf("Current")).toBe("—");
  expect(valueOf("State")).toBe("—");
});

test("updates the current value on each new reading", () => {
  const readings = createReadingsStore(10);
  render(
    <ReadoutBar
      readings={readings}
      threshold={25}
      side="above"
      counts={counts}
    />,
  );

  act(() => readings.push({ t: 1, value: 26.2 }));
  expect(valueOf("Current")).toBe("26.20 °C");
  act(() => readings.push({ t: 2, value: 24.05 }));
  expect(valueOf("Current")).toBe("24.05 °C");
});

test("shows threshold, side as text and delivery counts", () => {
  render(
    <ReadoutBar
      readings={createReadingsStore(10)}
      threshold={25}
      side="above"
      counts={counts}
    />,
  );
  expect(valueOf("Threshold")).toBe("25.0 °C");
  expect(valueOf("State")).toBe("▲ Above");
  expect(valueOf("Alerts")).toBe("7");
  expect(valueOf("In flight")).toBe("3"); // queued + sent
  expect(valueOf("Acknowledged")).toBe("1");
});
