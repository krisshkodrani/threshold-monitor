import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { testAlert } from "../test/fakes";
import type { ConnectionStatus, DeliveryUpdate } from "./AlertTransport";
import { createInMemoryTransport } from "./inMemoryTransport";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const transport = createInMemoryTransport({
    acceptDelayMs: 100,
    clock: () => 0,
  });
  const statuses: ConnectionStatus["kind"][] = [];
  const updates: DeliveryUpdate[] = [];
  transport.onStatus((s) => statuses.push(s.kind));
  transport.onDelivery((u) => updates.push(u));
  return { transport, statuses, updates };
}

test("reports connecting, then open", () => {
  const { statuses } = setup();
  expect(statuses).toEqual(["connecting"]);
  vi.advanceTimersByTime(0);
  expect(statuses).toEqual(["connecting", "open"]);
});

test("an alert goes queued, sent, then accepted", () => {
  const { transport, updates } = setup();
  transport.send(testAlert("a"));
  expect(updates.map((u) => u.status)).toEqual(["queued", "sent"]);
  vi.advanceTimersByTime(100);
  expect(updates.at(-1)).toEqual({
    alertId: "a",
    status: "accepted",
    receivedAt: "1970-01-01T00:00:00.000Z",
  });
});

test("dispose closes, cancels pending work and ignores later sends", () => {
  const { transport, statuses, updates } = setup();
  transport.send(testAlert("a"));
  transport.dispose();
  expect(statuses.at(-1)).toBe("closed");
  expect(vi.getTimerCount()).toBe(0);

  transport.send(testAlert("b"));
  vi.advanceTimersByTime(1000);
  expect(updates.map((u) => u.status)).toEqual(["queued", "sent"]);
});
