import { describe, expect, test } from "vitest";
import { testAlert } from "../test/fakes";
import type {
  DeliveryStatus,
  DeliveryUpdate,
} from "../transport/AlertTransport";
import {
  alertCreated,
  alertsReducer,
  canTransition,
  deliveryUpdated,
  selectAlertCounts,
  selectAllAlerts,
  selectChartMarkers,
} from "./alertsSlice";

const NOW = "2026-10-14T09:30:01.000Z";

function stateWith(...ids: string[]) {
  let state = alertsReducer(undefined, { type: "init" });
  ids.forEach((id, i) => {
    const eventTime = new Date(Date.UTC(2026, 9, 14, 9, 0, i)).toISOString();
    state = alertsReducer(state, alertCreated(testAlert(id, { eventTime })));
  });
  return state;
}

function apply(
  state: ReturnType<typeof stateWith>,
  ...updates: DeliveryUpdate[]
) {
  return updates.reduce(
    (s, u) => alertsReducer(s, deliveryUpdated(u, NOW)),
    state,
  );
}

const sent = { alertId: "a", status: "sent" } as const;
const accepted = { alertId: "a", status: "accepted", receivedAt: NOW } as const;
const acknowledged = {
  alertId: "a",
  status: "acknowledged",
  operator: "Ana",
  at: NOW,
} as const;
const queued = { alertId: "a", status: "queued" } as const;

describe("alertsSlice", () => {
  test("a created alert starts queued with no attempts", () => {
    expect(stateWith("a").entities.a).toMatchObject({
      status: "queued",
      attempts: 0,
    });
  });

  test("moves through the normal lifecycle and records the details", () => {
    const alert = apply(stateWith("a"), sent, accepted, acknowledged).entities
      .a;
    expect(alert).toMatchObject({
      status: "acknowledged",
      attempts: 1,
      sentAt: NOW,
      acceptedAt: NOW,
      acceptedLocalAt: NOW,
      acknowledgement: { operator: "Ana", at: NOW },
    });
  });

  test("a timed-out alert can go back to queued and counts each send", () => {
    const alert = apply(stateWith("a"), sent, queued, sent).entities.a;
    expect(alert).toMatchObject({ status: "sent", attempts: 2 });
  });

  test("a duplicate accepted after acknowledgement does not move the status back", () => {
    const alert = apply(
      stateWith("a"),
      sent,
      accepted,
      acknowledged,
      accepted,
      queued,
    ).entities.a;
    expect(alert?.status).toBe("acknowledged");
  });

  test("an acknowledgement can arrive before the accept was seen", () => {
    expect(apply(stateWith("a"), sent, acknowledged).entities.a?.status).toBe(
      "acknowledged",
    );
  });

  test("updates for unknown alerts are ignored", () => {
    const state = stateWith("a");
    expect(apply(state, { alertId: "zzz", status: "sent" })).toEqual(state);
  });

  test.each<[DeliveryStatus, DeliveryStatus, boolean]>([
    ["queued", "dropped", true],
    ["sent", "queued", true],
    ["accepted", "sent", false],
    ["accepted", "acknowledged", true],
    ["acknowledged", "accepted", false],
    ["dropped", "sent", false],
  ])("transition %s -> %s allowed: %s", (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
  });

  test("keeps at most 200 alerts, removing the oldest", () => {
    const ids = Array.from({ length: 205 }, (_, i) => `id-${i}`);
    const state = stateWith(...ids);
    expect(state.ids).toHaveLength(200);
    expect(state.ids[0]).toBe("id-204"); // newest first
    expect(state.entities["id-4"]).toBeUndefined();
    expect(state.entities["id-5"]).toBeDefined();
  });

  test("selectors: newest first, counts by status, chart markers", () => {
    const alerts = apply(stateWith("a", "b"), sent);
    const root = { alerts };
    expect(selectAllAlerts(root).map((a) => a.id)).toEqual(["b", "a"]);
    expect(selectAlertCounts(root)).toMatchObject({
      total: 2,
      queued: 1,
      sent: 1,
    });
    expect(selectChartMarkers(root)[0]).toEqual({
      t: Date.UTC(2026, 9, 14, 9, 0, 1),
      direction: "up",
    });
  });
});
