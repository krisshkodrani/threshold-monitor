import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { Provider } from "react-redux";
import { expect, test, vi } from "vitest";
import { App } from "./App";
import { createReadingsStore } from "./data/readingsStore";
import { createAppStore } from "./store";
import { FakeSource, fakeTransportFactory } from "./test/fakes";

function renderApp() {
  const source = new FakeSource();
  const transports = fakeTransportFactory();
  const store = createAppStore();
  const onLogout = vi.fn();
  const view = render(
    <Provider store={store}>
      <App
        source={source}
        readings={createReadingsStore(120)}
        createTransport={transports.create}
        identity={{ sourceId: "source-1", sourceLabel: "Monitor TST" }}
        initialRateHz={2}
        account={{ displayName: "Demo Monitor", onLogout }}
      />
    </Provider>,
    { reactStrictMode: true },
  );
  return { ...view, source, transports, onLogout };
}

test("shows who is signed in and logs out", async () => {
  const { onLogout } = renderApp();
  expect(screen.getByText("Demo Monitor")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Log out" }));
  expect(onLogout).toHaveBeenCalledOnce();
});

test("shows live readings and logs a crossing with its delivery status", () => {
  const { source, transports } = renderApp();
  expect(screen.getByText("Monitor TST")).toBeInTheDocument();

  act(() => source.emit(24, 26.2));
  expect(screen.getByText("26.20 °C")).toBeInTheDocument();

  const alertId = transports.alive()[0]!.sent[0]!.id;
  act(() => {
    transports.alive()[0]!.emitDelivery({
      alertId,
      status: "acknowledged",
      operator: "Ana",
      at: "2026-10-14T09:30:05.000Z",
    });
  });
  const log = screen.getByRole("region", { name: "Alert log" });
  expect(within(log).getByText("Acknowledged by Ana")).toBeInTheDocument();
});

// Regression: the form used to be keyed by the threshold, so committing a new
// value remounted it and dropped keyboard focus to <body>.
test("the threshold field keeps focus after committing with Enter", async () => {
  renderApp();
  const user = userEvent.setup();
  const input = screen.getByLabelText("Threshold (°C)");

  await user.clear(input);
  await user.type(input, "24{Enter}");

  expect(screen.getByLabelText("Threshold (°C)")).toBe(input); // same element
  expect(input).toHaveFocus();
  expect(input).toHaveValue("24.0");
  expect(screen.getByText("Threshold").nextElementSibling).toHaveTextContent(
    "24.0 °C",
  );
});

test("has no detectable accessibility violations", async () => {
  const { container, source } = renderApp();
  act(() => source.emit(24, 26.2, 24.1));
  const results = await axe.run(container, {
    // jsdom cannot compute colors, so contrast is checked by hand in the browser.
    rules: { "color-contrast": { enabled: false } },
  });
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
