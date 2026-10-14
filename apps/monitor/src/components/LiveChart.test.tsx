import { act, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { createReadingsStore } from "../data/readingsStore";
import type { ChartMarker } from "../domain/chartData";
import { LiveChart } from "./LiveChart";

// Not a snapshot of Recharts output: only our own decisions are checked
// (markers drawn as distinct shapes, an accessible summary of the chart).

const cfg = { threshold: 25, hysteresis: 0.6 };

function chartWith(values: number[], markers: ChartMarker[]) {
  const readings = createReadingsStore(120);
  values.forEach((value, i) => readings.push({ t: i * 500, value }));
  const view = render(
    <LiveChart readings={readings} markers={markers} cfg={cfg} />,
  );
  return { ...view, readings };
}

test("draws an up and a down crossing as different shapes", () => {
  const { container } = chartWith(
    [24, 25.5, 25.2, 24.5],
    [
      { t: 500, direction: "up" },
      { t: 1500, direction: "down" },
    ],
  );
  expect(container.querySelectorAll(".marker--up")).toHaveLength(1);
  expect(container.querySelectorAll(".marker--down")).toHaveLength(1);
});

test("draws no markers for plain readings", () => {
  const { container } = chartWith([24, 24.2, 24.1], []);
  expect(container.querySelectorAll(".marker--up, .marker--down")).toHaveLength(
    0,
  );
});

test("summarises the current value and threshold for screen readers", () => {
  const { readings } = chartWith([24, 24.5], []);
  const figure = screen.getByRole("figure");
  expect(figure).toHaveAccessibleName(
    "Temperature chart. Current 24.50 °C, threshold 25.0 °C.",
  );

  act(() => readings.push({ t: 1000, value: 26 }));
  expect(figure).toHaveAccessibleName(
    "Temperature chart. Current 26.00 °C, threshold 25.0 °C.",
  );
});
