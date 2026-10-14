import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ThresholdForm } from "./ThresholdForm";

function setup(threshold = 25) {
  const onCommit = vi.fn();
  render(<ThresholdForm threshold={threshold} onCommit={onCommit} />);
  const input = screen.getByLabelText("Threshold (°C)");
  return { onCommit, input, user: userEvent.setup() };
}

describe("ThresholdForm", () => {
  test("shows the active threshold in the field", () => {
    const { input } = setup(25);
    expect(input).toHaveValue("25.0");
  });

  test("Enter commits a valid value", async () => {
    const { onCommit, input, user } = setup();
    await user.clear(input);
    await user.type(input, "23.5{Enter}");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(23.5);
  });

  test("typing 25 never commits 2 along the way", async () => {
    const { onCommit, input, user } = setup(30);
    await user.clear(input);
    await user.type(input, "2");
    await user.type(input, "5");
    expect(onCommit).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onCommit.mock.calls).toEqual([[25]]);
  });

  test("accepts a comma as decimal separator", async () => {
    const { onCommit, input, user } = setup();
    await user.clear(input);
    await user.type(input, "22,5{Enter}");
    expect(onCommit).toHaveBeenCalledWith(22.5);
  });

  test("the Apply button commits", async () => {
    const { onCommit, input, user } = setup();
    await user.clear(input);
    await user.type(input, "21");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onCommit).toHaveBeenCalledWith(21);
  });

  test("leaving the field commits", async () => {
    const { onCommit, input, user } = setup();
    await user.clear(input);
    await user.type(input, "24");
    await user.tab();
    expect(onCommit).toHaveBeenCalledWith(24);
  });

  test("an invalid value shows a linked error and does not commit", async () => {
    const { onCommit, input, user } = setup();
    await user.clear(input);
    await user.type(input, "abc{Enter}");
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Use a number such as 25.5./);
  });

  test("an out of range value explains the range", async () => {
    const { onCommit, input, user } = setup();
    await user.clear(input);
    await user.type(input, "120{Enter}");
    expect(onCommit).not.toHaveBeenCalled();
    expect(
      screen.getByText("Keep it between −40 and 80 °C."),
    ).toBeInTheDocument();
  });

  test("shows the active threshold while the draft differs", async () => {
    const { input, user } = setup(25);
    expect(screen.queryByText(/Active:/)).not.toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "2");
    expect(screen.getByText("Active: 25.0 °C")).toBeInTheDocument();
  });

  test("re-entering the active value does not commit again", async () => {
    const { onCommit, input, user } = setup(25);
    await user.clear(input);
    await user.type(input, "25{Enter}");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
