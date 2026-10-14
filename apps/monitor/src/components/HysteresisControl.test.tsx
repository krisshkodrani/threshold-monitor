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

test("reports slider changes rounded to one decimal", () => {
  const onChange = vi.fn();
  render(<HysteresisControl value={0.6} onChange={onChange} />);
  // Browsers can report float noise from step arithmetic.
  fireEvent.change(screen.getByRole("slider"), {
    target: { value: "0.30000000000000004" },
  });
  expect(onChange).toHaveBeenCalledWith(0.3);
});
