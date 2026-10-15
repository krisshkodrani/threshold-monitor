import type { Alert } from "@app/protocol";
import { beforeEach, describe, expect, test } from "vitest";
import { createMemoryAlertStore, type AlertStore } from "./alertStore";
import { createReadingsBuffer, type ReadingsBuffer } from "./readingsBuffer";
import { route, type RouteContext, type Sender } from "./routing";
import { createMemorySettingsStore, type SettingsStore } from "./settingsStore";

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

const SENSOR = {
  sensorId: "5d0a2f6e-1c3b-4e7a-9b8d-2f4e6a8c0b13",
  label: "Sensor 1",
  rateHz: 10,
};

let store: AlertStore;
let settings: SettingsStore;
let readings: ReadingsBuffer;
let connectedSensor: typeof SENSOR | null;
let ctx: RouteContext;
let tick: number;

beforeEach(() => {
  store = createMemoryAlertStore(10);
  settings = createMemorySettingsStore();
  readings = createReadingsBuffer(3);
  connectedSensor = SENSOR;
  tick = 0;
  ctx = {
    store,
    settings,
    readings,
    sensor: () => connectedSensor,
    now: () => `2026-10-14T09:30:0${++tick}.000Z`,
  };
});

const sensor: Sender = { role: "sensor", sensor: SENSOR };
const monitor: Sender = { role: "monitor", operator: "Mo", userId: 2 };
const sendAlert = () => route(sensor, { type: "alert", alert }, ctx);
const ack = (operator = "Ana", role: "control" | "monitor" = "control") =>
  route({ role, operator, userId: 1 }, { type: "ack", alertId: ALERT_ID }, ctx);

describe("alerts from the sensor", () => {
  test("a new alert is stored, confirmed to the sender and forwarded to monitors and control rooms", () => {
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
      { to: "views", message: { type: "alert", record } },
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

  test("a monitor may not send alerts any more", () => {
    expect(
      route(monitor, { type: "alert", alert }, ctx)[0]?.message,
    ).toMatchObject({ code: "NOT_ALLOWED", ref: ALERT_ID });
    expect(store.has(ALERT_ID)).toBe(false);
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
    { type: "hello", v: 3, role: "control", clientName: "x" },
    ctx,
  );
  expect(out[0]?.message).toMatchObject({ type: "error", code: "NOT_ALLOWED" });
});

describe("readings", () => {
  const reading = (t: number) =>
    ({ type: "reading", reading: { t, value: 24 } }) as const;

  test("a reading from the sensor goes to monitors and into the buffer", () => {
    expect(route(sensor, reading(1), ctx)).toEqual([
      { to: "monitors", message: reading(1) },
    ]);
    route(sensor, reading(2), ctx);
    route(sensor, reading(3), ctx);
    route(sensor, reading(4), ctx);
    expect(readings.all().map((r) => r.t)).toEqual([2, 3, 4]); // capacity 3
  });

  test("only the sensor sends readings", () => {
    expect(route(monitor, reading(1), ctx)[0]?.message).toMatchObject({
      code: "NOT_ALLOWED",
    });
    expect(readings.all()).toEqual([]);
  });
});

describe("settings", () => {
  const value = { threshold: 26.5, hysteresis: 0.4 };

  test("a monitor change is stored with its author and sent to monitors and the sensor", () => {
    const out = route(monitor, { type: "setSettings", settings: value }, ctx);
    const settingsMessage = {
      type: "settings",
      settings: { ...value, updatedBy: "Mo", at: "2026-10-14T09:30:01.000Z" },
    };
    expect(out).toEqual([
      { to: "monitors", message: settingsMessage },
      { to: "sensor", message: settingsMessage },
    ]);
    expect(settings.get(SENSOR.sensorId)).toEqual(settingsMessage.settings);
  });

  test("with no sensor connected, the change is kept for the last known sensor", () => {
    route(sensor, { type: "settingsApplied", settings: value }, ctx);
    connectedSensor = null;
    route(
      monitor,
      { type: "setSettings", settings: { ...value, hysteresis: 1 } },
      ctx,
    );
    expect(settings.get(SENSOR.sensorId)?.hysteresis).toBe(1);
  });

  test("without any known sensor, a change is refused", () => {
    connectedSensor = null;
    expect(
      route(monitor, { type: "setSettings", settings: value }, ctx)[0]?.message,
    ).toMatchObject({ code: "NOT_ALLOWED" });
  });

  test("the sensor's defaults are stored only when nothing is stored yet", () => {
    expect(
      route(sensor, { type: "settingsApplied", settings: value }, ctx),
    ).toEqual([
      {
        to: "monitors",
        message: {
          type: "settings",
          settings: {
            ...value,
            updatedBy: null,
            at: "2026-10-14T09:30:01.000Z",
          },
        },
      },
    ]);
    expect(
      route(
        sensor,
        { type: "settingsApplied", settings: { threshold: 0, hysteresis: 0 } },
        ctx,
      ),
    ).toEqual([]);
    expect(settings.get(SENSOR.sensorId)?.threshold).toBe(26.5);
  });

  test.each<[string, Sender]>([
    ["a control room", { role: "control", operator: "Ana", userId: 1 }],
    ["the sensor", sensor],
  ])("%s may not change the settings", (_label, sender) => {
    expect(
      route(sender, { type: "setSettings", settings: value }, ctx)[0]?.message,
    ).toMatchObject({ code: "NOT_ALLOWED" });
  });

  test("only the sensor reports applied settings", () => {
    expect(
      route(monitor, { type: "settingsApplied", settings: value }, ctx)[0]
        ?.message,
    ).toMatchObject({ code: "NOT_ALLOWED" });
  });
});
