import { act, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { createReadingsStore } from "../data/readingsStore";
import type { AlertCounts } from "../store/alertsSlice";
import { ReadoutBar } from "./ReadoutBar";

const counts: AlertCounts = { total: 7, received: 4, acknowledged: 3 };

/** The <dd> value next to a <dt> label. */
function valueOf(label: string) {
  return screen.getByText(label).nextElementSibling?.textContent;
}

test("shows placeholders before the first reading", () => {
  render(
    <ReadoutBar
      readings={createReadingsStore(10)}
      threshold={25}
      counts={counts}
    />,
  );
  expect(valueOf("Current")).toBe("—");
  expect(valueOf("State")).toBe("—");
});

test("updates the current value and its side on each new reading", () => {
  const readings = createReadingsStore(10);
  render(<ReadoutBar readings={readings} threshold={25} counts={counts} />);

  act(() => readings.push({ t: 1, value: 26.2 }));
  expect(valueOf("Current")).toBe("26.20 °C");
  expect(valueOf("State")).toBe("▲ Above");
  act(() => readings.push({ t: 2, value: 24.05 }));
  expect(valueOf("Current")).toBe("24.05 °C");
  expect(valueOf("State")).toBe("▼ Below");
});

test("shows the threshold and the alert counts", () => {
  render(
    <ReadoutBar
      readings={createReadingsStore(10)}
      threshold={25}
      counts={counts}
    />,
  );
  expect(valueOf("Threshold")).toBe("25.0 °C");
  expect(valueOf("Alerts")).toBe("7");
  expect(valueOf("Open")).toBe("4");
  expect(valueOf("Acknowledged")).toBe("3");
});
