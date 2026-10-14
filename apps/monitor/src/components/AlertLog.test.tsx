import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { AlertEntity } from "../store/alertsSlice";
import { testAlert } from "../test/fakes";
import { AlertLog } from "./AlertLog";

const base: AlertEntity = { ...testAlert("a"), status: "queued", attempts: 0 };

test("shows an empty state before the first crossing", () => {
  render(<AlertLog alerts={[]} />);
  expect(screen.getByText(/No crossings yet/)).toBeInTheDocument();
});

test("follows an alert through its status transitions", () => {
  const { rerender } = render(<AlertLog alerts={[base]} />);
  expect(screen.getByText("Queued")).toBeInTheDocument();

  rerender(<AlertLog alerts={[{ ...base, status: "sent", attempts: 1 }]} />);
  expect(screen.getByText("Sent")).toBeInTheDocument();

  const accepted: AlertEntity = {
    ...base,
    status: "accepted",
    attempts: 1,
    acceptedAt: "2026-10-14T09:30:00.120Z", // 120 ms after the event
  };
  rerender(<AlertLog alerts={[accepted]} />);
  expect(screen.getByText("Accepted")).toBeInTheDocument();
  expect(screen.getByText("120 ms")).toBeInTheDocument();

  rerender(
    <AlertLog
      alerts={[
        {
          ...accepted,
          status: "acknowledged",
          acknowledgement: { operator: "Ana", at: "2026-10-14T09:30:05.000Z" },
        },
      ]}
    />,
  );
  expect(screen.getByText("Acknowledged by Ana")).toBeInTheDocument();
});

test("shows the attempt count only after a resend", () => {
  const { rerender } = render(
    <AlertLog alerts={[{ ...base, status: "sent", attempts: 1 }]} />,
  );
  expect(screen.queryByText(/attempts/)).not.toBeInTheDocument();
  rerender(<AlertLog alerts={[{ ...base, status: "sent", attempts: 3 }]} />);
  expect(screen.getByText(/3 attempts/)).toBeInTheDocument();
});

test("direction is shown as text, not only as an arrow", () => {
  render(<AlertLog alerts={[{ ...base, direction: "down" }]} />);
  expect(screen.getByRole("cell", { name: /down/ })).toBeInTheDocument();
});
