import type { Alert } from "@app/protocol";
import { beforeEach, describe, expect, test } from "vitest";
import { createMemoryAlertStore, type AlertStore } from "./alertStore";
import { route, type RouteContext } from "./routing";

const ALERT_ID = "3f0c6a8e-6b1d-4c2a-9f4e-2a7d5b9c1e01";

const alert: Alert = {
  id: ALERT_ID,
  sourceId: "8b2e4d71-0c3f-4a59-b6e8-5d1a9f7c3b02",
  sourceLabel: "Monitor 8B2",
  metric: "temperature",
  unit: "°C",
  threshold: 25,
  hysteresis: 0.6,
  value: 25.4,
  direction: "up",
  eventTime: "2026-10-14T09:30:00.000Z",
};

let store: AlertStore;
let ctx: RouteContext;
let tick: number;

beforeEach(() => {
  store = createMemoryAlertStore(10);
  tick = 0;
  ctx = { store, now: () => `2026-10-14T09:30:0${++tick}.000Z` };
});

const monitor = { role: "monitor", operator: "Monitor", userId: 2 } as const;
const sendAlert = () => route(monitor, { type: "alert", alert }, ctx);
const ack = (operator = "Ana", role: "control" | "monitor" = "control") =>
  route({ role, operator, userId: 1 }, { type: "ack", alertId: ALERT_ID }, ctx);

describe("alerts from a monitor", () => {
  test("a new alert is stored, confirmed to the sender and forwarded to control rooms", () => {
    const out = sendAlert();
    const record = {
      ...alert,
      receivedAt: "2026-10-14T09:30:01.000Z",
      acknowledgement: null,
    };
    expect(out).toEqual([
      {
        to: "sender",
        message: {
          type: "accepted",
          alertId: ALERT_ID,
          receivedAt: record.receivedAt,
          duplicate: false,
        },
      },
      { to: "controls", message: { type: "alert", record } },
    ]);
    expect(store.get(ALERT_ID)).toEqual(record);
  });

  test("a resent alert is confirmed as duplicate and not forwarded again", () => {
    sendAlert();
    const out = sendAlert();
    expect(out).toEqual([
      {
        to: "sender",
        message: {
          type: "accepted",
          alertId: ALERT_ID,
          receivedAt: "2026-10-14T09:30:01.000Z", // the original receipt time
          duplicate: true,
        },
      },
    ]);
  });

  test("a control room may not send alerts", () => {
    const out = route(
      { role: "control", operator: "Ana", userId: 1 },
      { type: "alert", alert },
      ctx,
    );
    expect(out).toMatchObject([
      {
        to: "sender",
        message: {
          type: "error",
          code: "NOT_ALLOWED",
          ref: ALERT_ID,
        },
      },
    ]);
    expect(store.has(ALERT_ID)).toBe(false);
  });
});

describe("acknowledgements from a control room", () => {
  test("the first acknowledgement is stored and sent to everyone", () => {
    sendAlert();
    expect(ack("Ana")).toEqual([
      {
        to: "everyone",
        message: {
          type: "acknowledged",
          alertId: ALERT_ID,
          operator: "Ana",
          at: "2026-10-14T09:30:02.000Z",
        },
      },
    ]);
  });

  test("a later acknowledgement only tells the sender who was first", () => {
    sendAlert();
    ack("Ana");
    expect(ack("Ben")).toMatchObject([
      {
        to: "sender",
        message: {
          type: "acknowledged",
          operator: "Ana",
        },
      },
    ]);
  });

  test("an unknown alert is reported", () => {
    expect(ack()).toMatchObject([
      {
        to: "sender",
        message: {
          type: "error",
          code: "UNKNOWN_ALERT",
          ref: ALERT_ID,
        },
      },
    ]);
  });

  test("a monitor may not acknowledge", () => {
    sendAlert();
    expect(ack("Ana", "monitor")[0]?.message).toMatchObject({
      code: "NOT_ALLOWED",
    });
    expect(store.get(ALERT_ID)?.acknowledgement).toBeNull();
  });
});

test("a second hello is refused", () => {
  const out = route(
    monitor,
    { type: "hello", v: 2, role: "control", clientName: "x" },
    ctx,
  );
  expect(out[0]?.message).toMatchObject({ type: "error", code: "NOT_ALLOWED" });
});
