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
    { type: "hello", v: 1, role: "monitor", clientName: "Monitor A3F" },
    { type: "hello", v: 1, role: "control", clientName: "Control room" },
    { type: "alert", alert: makeAlert() },
    { type: "ack", alertId: ALERT_ID, operator: "Ana" },
  ];

  const serverMessages: ServerMessage[] = [
    { type: "welcome", connectionId: CONNECTION_ID, recent: [] },
    {
      type: "welcome",
      connectionId: CONNECTION_ID,
      recent: [makeRecord({ acknowledgement: { operator: "Ana", at: NOW } })],
    },
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
      JSON.stringify({ type: "hello", v: 2, role: "monitor", clientName: "x" }),
    );
    expect(result.ok).toBe(true);
  });

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
      value: { type: "ack", alertId: ALERT_ID, operator: "Ana" },
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
    ["a missing type", { alertId: ALERT_ID, operator: "Ana" }],
    ["an unknown type", { type: "subscribe", topic: "all" }],
    [
      "a server-only type sent by a client",
      { type: "welcome", connectionId: CONNECTION_ID, recent: [] },
    ],
    [
      "a role that does not exist",
      { type: "hello", v: 1, role: "admin", clientName: "x" },
    ],
    [
      "a fractional version",
      { type: "hello", v: 1.5, role: "monitor", clientName: "x" },
    ],
    [
      "an empty client name",
      { type: "hello", v: 1, role: "monitor", clientName: "" },
    ],
    ["a non uuid alert id", { type: "ack", alertId: "42", operator: "Ana" }],
    [
      "an oversize operator name",
      { type: "ack", alertId: ALERT_ID, operator: "x".repeat(41) },
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
      type: "welcome",
      connectionId: CONNECTION_ID,
      recent: Array.from({ length: 101 }, () => makeRecord()),
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
