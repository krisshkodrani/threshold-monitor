import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { expect, test, vi } from "vitest";
import { App } from "./App";
import { createReadingsStore } from "./data/readingsStore";
import { createAppStore } from "./store";
import { fakeConnect, record, SENSOR, SETTINGS } from "./test/fakes";

// A chart that fails during render, as a Recharts bug or bad data would.
vi.mock("./components/LiveChart", () => ({
  LiveChart: () => {
    throw new Error("chart failed");
  },
}));

test("an error in the chart leaves the readout, the settings and the log", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const relay = fakeConnect();
  render(
    <Provider store={createAppStore()}>
      <App
        connect={relay.connect}
        readings={createReadingsStore(120)}
        account={{ displayName: "Demo Monitor", onLogout: () => {} }}
      />
    </Provider>,
  );
  act(() =>
    relay.alive()[0]!.welcome([record(1)], {
      settings: SETTINGS,
      sensor: SENSOR,
    }),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The chart cannot be shown because of an error.",
  );
  expect(screen.getByLabelText("Threshold (°C)")).toBeInTheDocument();
  expect(screen.getByText(/Alert log/)).toBeInTheDocument();
  expect(screen.getByText("Current")).toBeInTheDocument();
});
