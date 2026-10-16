import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

let broken = true;
function Fragile() {
  if (broken) throw new Error("render failed");
  return <p>Chart</p>;
}

test("an error stays in its part; the rest of the page still renders", () => {
  broken = true;
  const onError = vi.fn();
  // React logs the caught error to the console; that is expected here.
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <>
      <ErrorBoundary name="The chart" onError={onError}>
        <Fragile />
      </ErrorBoundary>
      <p>Alert log</p>
    </>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The chart cannot be shown because of an error.",
  );
  expect(screen.getByText("Alert log")).toBeInTheDocument();
  expect(onError).toHaveBeenCalledOnce();
  expect(onError.mock.calls[0]![0]).toEqual(new Error("render failed"));
});

test("Try again renders the part again", () => {
  broken = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <ErrorBoundary name="The chart" onError={() => {}}>
      <Fragile />
    </ErrorBoundary>,
  );
  broken = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("Chart")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("without onError, the error goes to the console", () => {
  broken = true;
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <ErrorBoundary name="The table">
      <Fragile />
    </ErrorBoundary>,
  );
  expect(consoleError).toHaveBeenCalledWith(
    "The table failed",
    new Error("render failed"),
  );
});
