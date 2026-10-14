import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PlaybackControls } from "./PlaybackControls";

function setup(paused = false, rateHz = 2) {
  const onTogglePause = vi.fn();
  const onRateChange = vi.fn();
  const view = render(
    <PlaybackControls
      paused={paused}
      rateHz={rateHz}
      onTogglePause={onTogglePause}
      onRateChange={onRateChange}
    />,
  );
  return { ...view, onTogglePause, onRateChange, user: userEvent.setup() };
}

test("the button pauses while running and resumes while paused", async () => {
  const { user, onTogglePause, rerender } = setup(false);
  await user.click(screen.getByRole("button", { name: /Pause/ }));
  expect(onTogglePause).toHaveBeenCalledOnce();

  rerender(
    <PlaybackControls
      paused
      rateHz={2}
      onTogglePause={onTogglePause}
      onRateChange={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: /Resume/ })).toBeInTheDocument();
});

test("choosing a rate reports it as a number", async () => {
  const { user, onRateChange } = setup();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Readings per second" }),
    "10",
  );
  expect(onRateChange).toHaveBeenCalledWith(10);
});

test.each([
  [1, "120 s"],
  [10, "12 s"],
])("at %i/s explains the chart spans %s", (rate, span) => {
  setup(false, rate);
  expect(
    screen.getByRole("combobox", { name: "Readings per second" }),
  ).toHaveAccessibleDescription(
    `The chart shows the last 120 readings (${span}).`,
  );
});
