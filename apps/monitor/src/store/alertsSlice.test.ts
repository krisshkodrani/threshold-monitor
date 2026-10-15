import { describe, expect, test } from "vitest";
import { limits } from "../config";
import { record } from "../test/fakes";
import { createAppStore } from "./index";
import {
  acknowledged,
  alertReceived,
  selectAlertCounts,
  selectAllAlerts,
  selectChartMarkers,
  selectLoggedAlerts,
  welcomed,
} from "./alertsSlice";

const ack = { operator: "Ana", at: "2026-10-14T09:31:00.000Z" };

describe("alerts slice", () => {
  test("welcome replaces the list, newest first", () => {
    const store = createAppStore();
    store.dispatch(alertReceived(record(9)));
    store.dispatch(welcomed([record(1), record(3), record(2)]));
    expect(selectAllAlerts(store.getState()).map((a) => a.id)).toEqual(
      [3, 2, 1].map((n) => record(n).id),
    );
  });

  test("a received alert is added once", () => {
    const store = createAppStore();
    store.dispatch(alertReceived(record(1)));
    store.dispatch(alertReceived(record(1)));
    expect(selectAllAlerts(store.getState())).toHaveLength(1);
  });

  test("the first acknowledgement wins, and an older copy does not undo it", () => {
    const store = createAppStore();
    store.dispatch(alertReceived(record(1)));
    store.dispatch(acknowledged({ alertId: record(1).id, ...ack }));
    store.dispatch(
      acknowledged({ alertId: record(1).id, operator: "Ben", at: ack.at }),
    );
    store.dispatch(alertReceived(record(1))); // an old, unacknowledged copy
    expect(selectAllAlerts(store.getState())[0]?.acknowledgement).toEqual(ack);
  });

  test("an acknowledgement for an unknown alert is ignored", () => {
    const store = createAppStore();
    store.dispatch(acknowledged({ alertId: record(5).id, ...ack }));
    expect(selectAllAlerts(store.getState())).toEqual([]);
  });

  test("memory is bounded; the log shows the newest only", () => {
    const store = createAppStore();
    for (let n = 1; n <= limits.storedAlerts + 10; n++)
      store.dispatch(
        alertReceived(
          record(n, { eventTime: new Date(n * 1000).toISOString() }),
        ),
      );
    expect(selectAllAlerts(store.getState())).toHaveLength(limits.storedAlerts);
    expect(selectLoggedAlerts(store.getState())).toHaveLength(
      limits.loggedAlerts,
    );
  });

  test("counts and chart markers", () => {
    const store = createAppStore();
    store.dispatch(
      welcomed([
        record(1),
        record(2, { acknowledgement: ack, direction: "down" }),
      ]),
    );
    expect(selectAlertCounts(store.getState())).toEqual({
      total: 2,
      received: 1,
      acknowledged: 1,
    });
    expect(
      selectChartMarkers(store.getState())
        .map((m) => m.direction)
        .sort(),
    ).toEqual(["down", "up"]);
  });
});
