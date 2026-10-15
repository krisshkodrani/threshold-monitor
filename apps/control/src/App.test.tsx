import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, test } from "vitest";
import { App } from "./App";
import { saveOperator } from "./operator";
import { fakeConnect, memoryStorage, record, uuid } from "./test/fakes";

function renderApp({ operator }: { operator?: string } = {}) {
  const storage = memoryStorage();
  if (operator) saveOperator(() => storage, operator);
  const relay = fakeConnect();
  const view = render(<App connect={relay.connect} storage={() => storage} />, {
    reactStrictMode: true,
  });
  const connection = () => relay.alive()[0]!;
  return { ...view, relay, storage, connection };
}

const ackButtons = () =>
  screen.queryAllByRole("button", { name: /^Acknowledge/ });

test("keeps exactly one connection alive under StrictMode", () => {
  const { relay } = renderApp();
  expect(relay.alive()).toHaveLength(1);
});

test("shows alarms from the welcome and new ones, with the unacknowledged count", () => {
  const { connection } = renderApp({ operator: "Ada" });
  act(() => connection().welcome([record(1)]));
  act(() => connection().receive({ type: "alert", record: record(2) }));

  expect(screen.getByText(/unacknowledged/)).toHaveTextContent(
    "2 unacknowledged",
  );
  expect(ackButtons()).toHaveLength(2);
});

test("Acknowledge is disabled until an operator name is saved", async () => {
  const user = userEvent.setup();
  const { connection, storage } = renderApp();
  act(() => connection().welcome([record(1)]));

  expect(ackButtons()[0]).toBeDisabled();
  expect(
    screen.getByText("Enter your name to acknowledge alarms."),
  ).toBeInTheDocument();

  await user.type(screen.getByLabelText("Operator name"), "  Ada ");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(ackButtons()[0]).toBeEnabled();
  expect(screen.getByText("Acknowledging as Ada.")).toBeInTheDocument();
  expect(storage.getItem("threshold-control:operator:v1")).toBe("Ada");
});

test("an empty operator name is refused", async () => {
  const user = userEvent.setup();
  renderApp();
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByLabelText("Operator name")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByText("Enter 1 to 40 characters.")).toBeInTheDocument();
});

test("clicking Acknowledge sends ack; the relay's answer shows who and when", async () => {
  const user = userEvent.setup();
  const { connection } = renderApp({ operator: "Ada" });
  act(() => connection().welcome([record(1)]));

  await user.click(ackButtons()[0]!);
  expect(connection().sent).toEqual([
    { type: "ack", alertId: uuid(1), operator: "Ada" },
  ]);
  expect(
    screen.getByRole("button", { name: /^Acknowledge/ }),
  ).toHaveTextContent("Acknowledging…");

  act(() =>
    connection().receive({
      type: "acknowledged",
      alertId: uuid(1),
      operator: "Ada",
      at: "2026-10-14T09:31:00.000Z",
    }),
  );
  expect(ackButtons()).toHaveLength(0);
  expect(screen.getByText(/Acknowledged by Ada at/)).toBeInTheDocument();
  expect(screen.getByText(/unacknowledged/)).toHaveTextContent(
    "0 unacknowledged",
  );
});

test("a refused ack is reported and can be tried again", async () => {
  const user = userEvent.setup();
  const { connection } = renderApp({ operator: "Ada" });
  act(() => connection().welcome([record(1)]));
  await user.click(ackButtons()[0]!);

  act(() =>
    connection().receive({
      type: "error",
      code: "UNKNOWN_ALERT",
      message: "No such alert (never seen or expired).",
      ref: uuid(1),
    }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("No such alert");
  expect(ackButtons()[0]).toBeEnabled();
});

test("Acknowledge is disabled while disconnected", () => {
  const { connection } = renderApp({ operator: "Ada" });
  act(() => connection().welcome([record(1)]));
  act(() =>
    connection().status({ kind: "reconnecting", attempt: 1, retryAt: 0 }),
  );
  expect(ackButtons()[0]).toBeDisabled();
});

test("the filter hides acknowledged alarms and Clear removes them", async () => {
  const user = userEvent.setup();
  const { connection } = renderApp({ operator: "Ada" });
  const acked = record(1, {
    acknowledgement: { operator: "Grace", at: "2026-10-14T09:31:00.000Z" },
  });
  act(() => connection().welcome([record(2), acked]));
  const rows = () =>
    within(screen.getAllByRole("table")[0]!).getAllByRole("row");
  expect(rows()).toHaveLength(3); // header + 2

  await user.click(screen.getByLabelText("Unacknowledged only"));
  expect(rows()).toHaveLength(2);

  await user.click(screen.getByLabelText("Unacknowledged only"));
  await user.click(screen.getByRole("button", { name: "Clear acknowledged" }));
  expect(rows()).toHaveLength(2);
  expect(screen.queryByText(/Grace/)).not.toBeInTheDocument();
});

test("has no detectable accessibility violations", async () => {
  const { container, connection } = renderApp({ operator: "Ada" });
  act(() =>
    connection().welcome([
      record(2),
      record(1, {
        acknowledgement: { operator: "Grace", at: "2026-10-14T09:31:00.000Z" },
      }),
    ]),
  );
  const results = await axe.run(container, {
    // jsdom cannot compute colors; contrast is checked in the browser.
    rules: { "color-contrast": { enabled: false } },
  });
  expect(results.violations).toEqual([]);
});
