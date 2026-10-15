import type {
  Alert,
  ReadingValue,
  SettingsRecord,
  SettingsValue,
} from "@app/protocol";
import { expect, test } from "vitest";
import { startAgent } from "./agent";
import type { DataSource, Reading } from "./data/DataSource";
import type { AlertTransport } from "./transport/AlertTransport";

/** Readings by hand, one second apart. */
function fakeSource() {
  const listeners = new Set<(r: Reading) => void>();
  let t = 1_791_000_000_000;
  const source: DataSource = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setRate() {},
    pause() {},
    resume() {},
  };
  return {
    source,
    emit: (...values: number[]) => {
      for (const value of values) {
        t += 1000;
        for (const l of listeners) l({ t, value });
      }
    },
    listeners,
  };
}

function fakeTransport() {
  const alerts: Alert[] = [];
  const readings: ReadingValue[] = [];
  const reported: SettingsValue[] = [];
  const settingsListeners = new Set<(s: SettingsRecord | null) => void>();
  const transport: AlertTransport = {
    send: (alert) => alerts.push(alert),
    sendReading: (reading) => readings.push(reading),
    reportSettings: (s) => reported.push(s),
    onSettings(listener) {
      settingsListeners.add(listener);
      return () => settingsListeners.delete(listener);
    },
    onStatus: () => () => {},
    onDelivery: () => () => {},
    dispose() {},
  };
  const welcome = (settings: SettingsRecord | null) => {
    for (const l of settingsListeners) l(settings);
  };
  return { transport, alerts, readings, reported, welcome, settingsListeners };
}

const SENSOR = {
  sensorId: "5d0a2f6e-1c3b-4e7a-9b8d-2f4e6a8c0b13",
  label: "Sensor 1",
  rateHz: 10,
};

function setup() {
  const src = fakeSource();
  const tr = fakeTransport();
  let n = 0;
  const agent = startAgent({
    source: src.source,
    transport: tr.transport,
    sensor: SENSOR,
    metric: { key: "temperature", unit: "°C" },
    defaults: { threshold: 25, hysteresis: 0.6 },
    newId: () => `alert-${++n}`,
  });
  return { ...src, ...tr, agent };
}

const stored = (threshold: number, hysteresis = 0.6): SettingsRecord => ({
  threshold,
  hysteresis,
  updatedBy: "Ana",
  at: "2026-10-14T09:31:00.000Z",
});

test("each reading goes to the relay", () => {
  const { emit, readings } = setup();
  emit(24.1, 24.2);
  expect(readings.map((r) => r.value)).toEqual([24.1, 24.2]);
  expect(Number.isInteger(readings[0]!.t)).toBe(true);
});

test("a crossing becomes an alert with the sensor as its source", () => {
  const { emit, alerts } = setup();
  emit(24, 25.5);
  expect(alerts).toEqual([
    expect.objectContaining({
      id: "alert-1",
      sourceId: SENSOR.sensorId,
      sourceLabel: "Sensor 1",
      metric: "temperature",
      unit: "°C",
      threshold: 25,
      hysteresis: 0.6,
      value: 25.5,
      direction: "up",
    }),
  ]);
});

test("without stored settings, the agent reports its defaults", () => {
  const { welcome, reported } = setup();
  welcome(null);
  expect(reported).toEqual([{ threshold: 25, hysteresis: 0.6 }]);
});

test("stored settings from the relay replace the defaults", () => {
  const { welcome, emit, alerts, agent, reported } = setup();
  welcome(stored(20));
  expect(agent.settings()).toEqual({ threshold: 20, hysteresis: 0.6 });
  expect(reported).toEqual([]);
  emit(19, 21);
  expect(alerts.map((a) => [a.direction, a.threshold])).toEqual([["up", 20]]);
});

test("a settings change never raises an alert by itself (ADR 0003)", () => {
  const { welcome, emit, alerts } = setup();
  emit(24, 24.2); // below 25
  welcome(stored(23)); // now the last value is above the new threshold
  emit(24.3); // still above: no crossing
  expect(alerts).toEqual([]);
  emit(22); // below 23 - 0.3: a real crossing
  expect(alerts.map((a) => a.direction)).toEqual(["down"]);
});

test("stop unsubscribes from the source and the settings", () => {
  const { agent, listeners, settingsListeners } = setup();
  agent.stop();
  expect(listeners.size).toBe(0);
  expect(settingsListeners.size).toBe(0);
});
