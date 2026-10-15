import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { Provider } from "react-redux";
import { expect, test, vi } from "vitest";
import { App } from "./App";
import { createReadingsStore } from "./data/readingsStore";
import { createAppStore } from "./store";
import { fakeConnect, record, SENSOR, SETTINGS } from "./test/fakes";

function renderApp() {
  const relay = fakeConnect();
  const readings = createReadingsStore(120);
  const onLogout = vi.fn();
  const view = render(
    <Provider store={createAppStore()}>
      <App
        connect={relay.connect}
        readings={readings}
        account={{ displayName: "Demo Monitor", onLogout }}
      />
    </Provider>,
    { reactStrictMode: true },
  );
  const connection = () => relay.alive()[0]!;
  return { ...view, relay, readings, connection, onLogout };
}

/** The <dd> value next to a <dt> label. */
const valueOf = (label: string) =>
  screen.getByText(label).nextElementSibling?.textContent;

test("keeps exactly one connection alive under StrictMode", () => {
  const { relay } = renderApp();
  expect(relay.alive()).toHaveLength(1);
});

test("shows who is signed in and logs out", async () => {
  const { onLogout } = renderApp();
  expect(screen.getByText("Demo Monitor")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Log out" }));
  expect(onLogout).toHaveBeenCalledOnce();
});

test("the welcome fills the chart, the log, the settings and the sensor", () => {
  const { connection } = renderApp();
  act(() =>
    connection().welcome([record(1)], {
      settings: { ...SETTINGS, threshold: 24 },
      sensor: SENSOR,
      readings: [
        { t: 1_000, value: 23.5 },
        { t: 1_100, value: 24.6 },
      ],
    }),
  );
  expect(screen.getByText("Sensor TST · online")).toBeInTheDocument();
  expect(valueOf("Current")).toBe("24.60 °C");
  expect(valueOf("Threshold")).toBe("24.0 °C");
  expect(valueOf("Alerts")).toBe("1");
  expect(screen.getByText(/sends 10 readings each second/)).toBeInTheDocument();
});

test("live readings, alerts and acknowledgements from the relay", () => {
  const { connection } = renderApp();
  act(() => connection().welcome([], { settings: SETTINGS, sensor: SENSOR }));

  act(() =>
    connection().receive({ type: "reading", reading: { t: 5, value: 26.2 } }),
  );
  expect(valueOf("Current")).toBe("26.20 °C");

  act(() => connection().receive({ type: "alert", record: record(7) }));
  const log = screen.getByRole("region", { name: /^Alert log/ });
  expect(within(log).getByText("Received")).toBeInTheDocument();

  act(() =>
    connection().receive({
      type: "acknowledged",
      alertId: record(7).id,
      operator: "Ana",
      at: "2026-10-14T09:31:00.000Z",
    }),
  );
  expect(within(log).getByText("Acknowledged by Ana")).toBeInTheDocument();
});

test("the sensor status follows the relay", () => {
  const { connection } = renderApp();
  act(() => connection().welcome([], { settings: SETTINGS, sensor: SENSOR }));
  act(() => connection().receive({ type: "sensorStatus", sensor: null }));
  expect(screen.getByText("Sensor offline")).toBeInTheDocument();
});

test("a new threshold is sent to the relay, not applied locally", async () => {
  const user = userEvent.setup();
  const { connection } = renderApp();
  act(() => connection().welcome([], { settings: SETTINGS, sensor: SENSOR }));

  const input = screen.getByLabelText("Threshold (°C)");
  await user.clear(input);
  await user.type(input, "24{Enter}");
  expect(connection().sent).toEqual([
    { type: "setSettings", settings: { threshold: 24, hysteresis: 0.6 } },
  ]);
  // The field keeps focus (regression: a key on the form used to remount it).
  expect(input).toHaveFocus();
  expect(valueOf("Threshold")).toBe("25.0 °C"); // until the relay confirms

  act(() =>
    connection().receive({
      type: "settings",
      settings: { ...SETTINGS, threshold: 24, updatedBy: "Demo Monitor" },
    }),
  );
  expect(valueOf("Threshold")).toBe("24.0 °C");
  expect(
    screen.getByText(/Settings changed by Demo Monitor/),
  ).toBeInTheDocument();
});

test("a change from another tab updates the form", () => {
  const { connection } = renderApp();
  act(() => connection().welcome([], { settings: SETTINGS, sensor: SENSOR }));
  act(() =>
    connection().receive({
      type: "settings",
      settings: { ...SETTINGS, threshold: 21.5, updatedBy: "Ana" },
    }),
  );
  expect(screen.getByLabelText("Threshold (°C)")).toHaveValue("21.5");
});

test("the settings are disabled until the relay sends them", () => {
  const { connection } = renderApp();
  expect(screen.getByLabelText("Threshold (°C)")).toBeDisabled();
  act(() => connection().welcome([], { settings: SETTINGS, sensor: SENSOR }));
  expect(screen.getByLabelText("Threshold (°C)")).toBeEnabled();
});

test("a relay error is shown", () => {
  const { connection } = renderApp();
  act(() => connection().welcome([], { settings: SETTINGS, sensor: SENSOR }));
  act(() =>
    connection().receive({
      type: "error",
      code: "NOT_ALLOWED",
      message: "No sensor has connected yet.",
    }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "No sensor has connected yet.",
  );
});

test("has no detectable accessibility violations", async () => {
  const { container, connection } = renderApp();
  act(() =>
    connection().welcome([record(1)], {
      settings: SETTINGS,
      sensor: SENSOR,
      readings: [{ t: 1, value: 24 }],
    }),
  );
  const results = await axe.run(container, {
    // jsdom cannot compute colors, so contrast is checked by hand in the browser.
    rules: { "color-contrast": { enabled: false } },
  });
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
