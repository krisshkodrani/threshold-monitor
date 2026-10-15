import { describe, expect, test } from "vitest";
import {
  alertSchema,
  clientMessageSchema,
  encode,
  parseClientMessage,
  parseServerMessage,
  serverMessageSchema,
  type Alert,
  type AlertRecord,
  type ClientMessage,
  type ServerMessage,
} from "./index";

const ALERT_ID = "3f0c6a8e-6b1d-4c2a-9f4e-2a7d5b9c1e01";
const SOURCE_ID = "8b2e4d71-0c3f-4a59-b6e8-5d1a9f7c3b02";
const CONNECTION_ID = "c4a7e9b2-5f18-4d3c-8a6e-0b9d2f1c7e03";
const NOW = "2026-10-14T09:30:00.000Z";
const SENSOR = {
  sensorId: "5d0a2f6e-1c3b-4e7a-9b8d-2f4e6a8c0b13",
  label: "Sensor 1",
  rateHz: 10,
};
const SETTINGS = { threshold: 25, hysteresis: 0.6 };
const emptyWelcome: Extract<ServerMessage, { type: "welcome" }> = {
  type: "welcome",
  connectionId: CONNECTION_ID,
  recent: [],
  settings: null,
  sensor: null,
  readings: [],
};

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: ALERT_ID,
    sourceId: SOURCE_ID,
    sourceLabel: "Monitor A3F",
    metric: "temperature",
    unit: "°C",
    threshold: 25,
    hysteresis: 0.6,
    value: 25.42,
    direction: "up",
    eventTime: NOW,
    ...overrides,
  };
}

function makeRecord(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    ...makeAlert(),
    receivedAt: NOW,
    acknowledgement: null,
    ...overrides,
  };
}

describe("valid messages round trip through encode and parse", () => {
  const clientMessages: ClientMessage[] = [
    { type: "hello", v: 3, role: "monitor", clientName: "Monitor A3F" },
    { type: "hello", v: 3, role: "control", clientName: "Control room" },
    {
      type: "hello",
      v: 3,
      role: "sensor",
      clientName: "Sensor 1",
      token: "a-long-sensor-token",
      sensor: SENSOR,
    },
    { type: "alert", alert: makeAlert() },
    { type: "ack", alertId: ALERT_ID },
    { type: "reading", reading: { t: 1_791_000_000_000, value: 24.31 } },
    { type: "settingsApplied", settings: SETTINGS },
    { type: "setSettings", settings: { threshold: -12.5, hysteresis: 0 } },
  ];

  const serverMessages: ServerMessage[] = [
    emptyWelcome,
    {
      ...emptyWelcome,
      recent: [makeRecord({ acknowledgement: { operator: "Ana", at: NOW } })],
      settings: { ...SETTINGS, updatedBy: "Ana", at: NOW },
      sensor: SENSOR,
      readings: [
        { t: 1_791_000_000_000, value: 24.3 },
        { t: 1_791_000_000_100, value: 24.35 },
      ],
    },
    { type: "reading", reading: { t: 1_791_000_000_000, value: 24.31 } },
    {
      type: "settings",
      settings: { ...SETTINGS, updatedBy: null, at: NOW },
    },
    { type: "sensorStatus", sensor: SENSOR },
    { type: "sensorStatus", sensor: null },
    { type: "alert", record: makeRecord() },
    { type: "accepted", alertId: ALERT_ID, receivedAt: NOW, duplicate: false },
    { type: "acknowledged", alertId: ALERT_ID, operator: "Ana", at: NOW },
    { type: "error", code: "RATE_LIMITED", message: "Slow down." },
    {
      type: "error",
      code: "UNKNOWN_ALERT",
      message: "No such alert.",
      ref: ALERT_ID,
    },
  ];

  test.each(clientMessages)("client $type", (message) => {
    expect(parseClientMessage(encode(message))).toEqual({
      ok: true,
      value: message,
    });
  });

  test.each(serverMessages)("server $type", (message) => {
    expect(parseServerMessage(encode(message))).toEqual({
      ok: true,
      value: message,
    });
  });

  test("an unknown protocol version still parses, so the server can reject it explicitly", () => {
    const result = parseClientMessage(
      JSON.stringify({ type: "hello", v: 4, role: "monitor", clientName: "x" }),
    );
    expect(result.ok).toBe(true);
  });

  // Version 1 clients sent an operator name; it is now dropped, never trusted.
  test("unknown extra fields are stripped, not passed through", () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: "ack",
        alertId: ALERT_ID,
        operator: "Ana",
        admin: true,
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: { type: "ack", alertId: ALERT_ID },
    });
  });
});

describe("invalid input is rejected without throwing", () => {
  test("invalid JSON", () => {
    expect(parseClientMessage("{not json")).toEqual({
      ok: false,
      error: { reason: "invalid_json", message: "Message is not valid JSON." },
    });
    expect(parseServerMessage("").ok).toBe(false);
  });

  test.each([
    ["null", null],
    ["an array", []],
    ["a missing type", { alertId: ALERT_ID }],
    ["an unknown type", { type: "subscribe", topic: "all" }],
    ["a server-only type sent by a client", emptyWelcome],
    [
      "a role that does not exist",
      { type: "hello", v: 3, role: "admin", clientName: "x" },
    ],
    [
      "a fractional version",
      { type: "hello", v: 1.5, role: "monitor", clientName: "x" },
    ],
    [
      "an empty client name",
      { type: "hello", v: 3, role: "monitor", clientName: "" },
    ],
    ["a non uuid alert id", { type: "ack", alertId: "42" }],
    [
      "a reading with a fractional time",
      { type: "reading", reading: { t: 1.5, value: 24 } },
    ],
    [
      "a reading out of range",
      { type: "reading", reading: { t: 1, value: 1e7 } },
    ],
    [
      "a threshold above the settings limit",
      { type: "setSettings", settings: { threshold: 80.1, hysteresis: 0.6 } },
    ],
    [
      "a hysteresis above the settings limit",
      { type: "setSettings", settings: { threshold: 25, hysteresis: 2.1 } },
    ],
    [
      "a sensor hello with a bad sensor id",
      {
        type: "hello",
        v: 3,
        role: "sensor",
        clientName: "S",
        token: "t",
        sensor: { ...SENSOR, sensorId: "x" },
      },
    ],
  ])("client message with %s", (_label, payload) => {
    const result = parseClientMessage(JSON.stringify(payload));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("invalid_message");
  });

  test.each([
    ["an unknown direction", { direction: "sideways" }],
    ["a value above range", { value: 1e6 + 1 }],
    ["a threshold below range", { threshold: -1e6 - 1 }],
    ["a negative hysteresis", { hysteresis: -0.1 }],
    ["a string value", { value: "25" }],
    ["a non UTC timestamp", { eventTime: "2026-10-14T11:30:00+02:00" }],
    ["a date without time", { eventTime: "2026-10-14" }],
    ["an oversize source label", { sourceLabel: "x".repeat(61) }],
    ["an oversize unit", { unit: "x".repeat(11) }],
    [
      "a uuid that is not v4",
      { sourceId: "00000000-0000-1000-8000-000000000000" },
    ],
  ])("alert with %s", (_label, override) => {
    const message = { type: "alert", alert: { ...makeAlert(), ...override } };
    expect(parseClientMessage(JSON.stringify(message)).ok).toBe(false);
  });

  test("alert with a missing field", () => {
    const { value, ...withoutValue } = makeAlert();
    const message = { type: "alert", alert: withoutValue };
    expect(parseClientMessage(JSON.stringify(message)).ok).toBe(false);
  });

  // JSON cannot carry NaN or Infinity (JSON.stringify turns them into null),
  // so check the schema directly as well as the serialized form.
  test.each([NaN, Infinity, -Infinity])("non finite value %s", (value) => {
    expect(alertSchema.safeParse(makeAlert({ value })).success).toBe(false);
    const message = { type: "alert", alert: makeAlert({ value }) };
    expect(clientMessageSchema.safeParse(message).success).toBe(false);
    expect(parseClientMessage(JSON.stringify(message)).ok).toBe(false);
  });

  test("welcome with more than 100 recent records", () => {
    const message = {
      ...emptyWelcome,
      recent: Array.from({ length: 101 }, () => makeRecord()),
    };
    expect(serverMessageSchema.safeParse(message).success).toBe(false);
  });

  test("welcome with more than 120 readings", () => {
    const message = {
      ...emptyWelcome,
      readings: Array.from({ length: 121 }, (_, t) => ({ t, value: 1 })),
    };
    expect(serverMessageSchema.safeParse(message).success).toBe(false);
  });

  test("error with an unknown code", () => {
    const message = {
      type: "error",
      code: "TEAPOT",
      message: "short and stout",
    };
    expect(parseServerMessage(JSON.stringify(message)).ok).toBe(false);
  });

  test("the error summary names the failing field", () => {
    const message = {
      type: "alert",
      alert: makeAlert({ direction: "sideways" as "up" }),
    };
    const result = parseClientMessage(JSON.stringify(message));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("alert.direction");
  });
});
