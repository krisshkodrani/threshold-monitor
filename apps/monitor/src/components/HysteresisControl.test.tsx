import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { HysteresisControl } from "./HysteresisControl";

test("shows the band width and what it means", () => {
  render(<HysteresisControl value={0.6} onChange={() => {}} />);
  const slider = screen.getByRole("slider", { name: "Hysteresis band (°C)" });
  expect(slider).toHaveValue("0.6");
  expect(screen.getByText("0.6")).toBeInTheDocument();
  expect(screen.getByText(/±0.30 around the threshold/)).toBeInTheDocument();
});

test("reports the value on release, rounded to one decimal", () => {
  const onChange = vi.fn();
  render(<HysteresisControl value={0.6} onChange={onChange} />);
  const slider = screen.getByRole("slider");
  // Browsers can report float noise from step arithmetic.
  fireEvent.change(slider, { target: { value: "0.30000000000000004" } });
  fireEvent.pointerUp(slider);
  expect(onChange).toHaveBeenCalledExactlyOnceWith(0.3);
});

// Regression: the slider was controlled by the shared value only, so during a
// drag it jumped back until the relay answered, and each step sent a message.
test("a drag shows the draft and sends one change on release", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <HysteresisControl value={0.6} onChange={onChange} />,
  );
  const slider = screen.getByRole("slider");
  for (const step of ["0.8", "1.0", "1.2", "1.5"])
    fireEvent.change(slider, { target: { value: step } });
  expect(onChange).not.toHaveBeenCalled();
  expect(slider).toHaveValue("1.5");
  expect(screen.getByText("1.5")).toBeInTheDocument();

  fireEvent.pointerUp(slider);
  expect(onChange).toHaveBeenCalledExactlyOnceWith(1.5);
  // Until the relay confirms, the slider stays at the draft.
  expect(slider).toHaveValue("1.5");

  rerender(<HysteresisControl value={1.5} onChange={onChange} />);
  expect(slider).toHaveValue("1.5");
});

test("the keyboard sends the value on key up", () => {
  const onChange = vi.fn();
  render(<HysteresisControl value={0.6} onChange={onChange} />);
  const slider = screen.getByRole("slider");
  fireEvent.change(slider, { target: { value: "0.7" } });
  fireEvent.keyUp(slider, { key: "ArrowRight" });
  expect(onChange).toHaveBeenCalledExactlyOnceWith(0.7);
});

test("a change from another tab replaces the draft", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <HysteresisControl value={0.6} onChange={onChange} />,
  );
  const slider = screen.getByRole("slider");
  fireEvent.change(slider, { target: { value: "1.0" } });
  rerender(<HysteresisControl value={0.2} onChange={onChange} />);
  expect(slider).toHaveValue("0.2");
});

test("a release on the shared value sends nothing", () => {
  const onChange = vi.fn();
  render(<HysteresisControl value={0.6} onChange={onChange} />);
  const slider = screen.getByRole("slider");
  fireEvent.change(slider, { target: { value: "0.6" } });
  fireEvent.pointerUp(slider);
  expect(onChange).not.toHaveBeenCalled();
});
