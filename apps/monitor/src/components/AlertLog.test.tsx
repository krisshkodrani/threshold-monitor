import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { record } from "../test/fakes";
import { AlertLog } from "./AlertLog";

const base = record(1, {
  eventTime: "2026-10-14T09:30:00.000Z",
  receivedAt: "2026-10-14T09:30:00.120Z",
});

test("shows an empty state before the first crossing", () => {
  render(<AlertLog alerts={[]} />);
  expect(screen.getByText(/No crossings yet/)).toBeInTheDocument();
});

test("an alert is Received until an operator acknowledges it", () => {
  const { rerender } = render(<AlertLog alerts={[base]} />);
  expect(screen.getByText("Received")).toBeInTheDocument();

  rerender(
    <AlertLog
      alerts={[
        {
          ...base,
          acknowledgement: { operator: "Ana", at: "2026-10-14T09:30:05.000Z" },
        },
      ]}
    />,
  );
  expect(screen.getByText("Acknowledged by Ana")).toBeInTheDocument();
});

test("latency is from the reading at the sensor to the relay storing it", () => {
  render(<AlertLog alerts={[base]} />);
  expect(screen.getByText("120 ms")).toBeInTheDocument();
});

test("direction is shown as text, not only as an arrow", () => {
  render(<AlertLog alerts={[{ ...base, direction: "down" }]} />);
  expect(screen.getByRole("cell", { name: /down/ })).toBeInTheDocument();
});

test("the table scrolls in a focusable box, and the heading counts the alerts", () => {
  render(<AlertLog alerts={[base, record(2)]} />);
  const box = screen.getByRole("region", { name: "Scrollable alert log" });
  expect(box).toHaveAttribute("tabindex", "0");
  expect(box).toContainElement(screen.getByRole("table"));
  expect(
    screen.getByRole("heading", { name: "Alert log · 2 alerts" }),
  ).toBeInTheDocument();
});
