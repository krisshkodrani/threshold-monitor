import { describe, expect, test } from "vitest";
import { record, uuid } from "../test/fakes";
import {
  alarmsReducer,
  initialAlarmsState,
  MAX_ALARMS,
  unacknowledgedCount,
  type AlarmsAction,
  type AlarmsState,
} from "./alarms";

const ack = { operator: "Ada", at: "2026-10-14T09:31:00.000Z" };

function run(...actions: AlarmsAction[]): AlarmsState {
  return actions.reduce(alarmsReducer, initialAlarmsState);
}

const ids = (state: AlarmsState) => state.alarms.map((a) => a.id);

describe("alarm list", () => {
  test("keeps alarms newest first by receipt time", () => {
    const state = run(
      { type: "alertReceived", record: record(1) },
      { type: "alertReceived", record: record(3) },
      { type: "alertReceived", record: record(2) },
    );
    expect(ids(state)).toEqual([uuid(3), uuid(2), uuid(1)]);
  });

  test("a repeated alert is stored once", () => {
    const state = run(
      { type: "alertReceived", record: record(1) },
      { type: "alertReceived", record: record(1) },
    );
    expect(ids(state)).toEqual([uuid(1)]);
  });

  test("welcome merges recent alarms with the ones already shown", () => {
    const state = run(
      { type: "alertReceived", record: record(1) },
      { type: "welcomed", recent: [record(3), record(2), record(1)] },
    );
    expect(ids(state)).toEqual([uuid(3), uuid(2), uuid(1)]);
  });

  test("keeps at most MAX_ALARMS, dropping the oldest", () => {
    const recent = Array.from({ length: MAX_ALARMS + 5 }, (_, i) =>
      record(i, {
        receivedAt: new Date(Date.UTC(2026, 9, 14) + i * 1000).toISOString(),
      }),
    );
    const state = run({ type: "welcomed", recent });
    expect(state.alarms).toHaveLength(MAX_ALARMS);
    expect(state.alarms.at(-1)?.id).toBe(uuid(5));
  });
});

describe("acknowledgements", () => {
  test("an acknowledgement is recorded with operator and time", () => {
    const state = run(
      { type: "alertReceived", record: record(1) },
      { type: "acknowledged", alertId: uuid(1), ...ack },
    );
    expect(state.alarms[0]?.acknowledgement).toEqual(ack);
    expect(unacknowledgedCount(state)).toBe(0);
  });

  test("the first acknowledgement wins", () => {
    const state = run(
      { type: "alertReceived", record: record(1) },
      { type: "acknowledged", alertId: uuid(1), ...ack },
      {
        type: "acknowledged",
        alertId: uuid(1),
        operator: "Grace",
        at: "2026-10-14T09:32:00.000Z",
      },
    );
    expect(state.alarms[0]?.acknowledgement).toEqual(ack);
  });

  test("an older unacknowledged copy never removes an acknowledgement", () => {
    const state = run(
      { type: "alertReceived", record: record(1) },
      { type: "acknowledged", alertId: uuid(1), ...ack },
      { type: "alertReceived", record: record(1) },
      { type: "welcomed", recent: [record(1)] },
    );
    expect(state.alarms[0]?.acknowledgement).toEqual(ack);
  });

  test("an acknowledgement for an unknown alarm changes nothing", () => {
    const before = run({ type: "alertReceived", record: record(1) });
    const after = alarmsReducer(before, {
      type: "acknowledged",
      alertId: uuid(9),
      ...ack,
    });
    expect(after.alarms).toEqual(before.alarms);
  });

  test("a pending ack ends on acknowledged, on failure, on disconnect and on welcome", () => {
    const sent: AlarmsAction = { type: "ackSent", alertId: uuid(1) };
    expect(run(sent, sent).pendingAcks).toEqual([uuid(1)]);
    for (const end of [
      { type: "acknowledged", alertId: uuid(1), ...ack },
      { type: "ackFailed", alertId: uuid(1) },
      { type: "disconnected" },
      { type: "welcomed", recent: [] },
    ] as AlarmsAction[]) {
      expect(run(sent, end).pendingAcks).toEqual([]);
    }
  });
});

test("cleared removes acknowledged alarms only", () => {
  const state = run(
    { type: "alertReceived", record: record(1) },
    { type: "alertReceived", record: record(2) },
    { type: "acknowledged", alertId: uuid(1), ...ack },
    { type: "cleared" },
  );
  expect(ids(state)).toEqual([uuid(2)]);
  expect(unacknowledgedCount(state)).toBe(1);
});
