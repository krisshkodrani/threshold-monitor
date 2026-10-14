import type { Alert } from "@app/protocol";
import {
  createEntityAdapter,
  createSelector,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";
import { limits } from "../config";
import type { ChartMarker } from "../domain/chartData";
import type {
  DeliveryStatus,
  DeliveryUpdate,
} from "../transport/AlertTransport";

export type AlertEntity = Alert & {
  status: DeliveryStatus;
  attempts: number;
  sentAt?: string;
  acceptedAt?: string;
  acknowledgement?: { operator: string; at: string };
};

/**
 * Which status changes are allowed. Updates can arrive late or twice (a resend
 * is answered with a duplicate `accepted`, possibly after the operator already
 * acknowledged), so a status must never move backwards.
 * - queued <-> sent: an alert goes back to queued when its accept times out.
 * - accepted: can only become acknowledged.
 * - acknowledged, dropped: final.
 */
export function canTransition(
  from: DeliveryStatus,
  to: DeliveryStatus,
): boolean {
  switch (from) {
    case "queued":
    case "sent":
      return true;
    case "accepted":
      return to === "acknowledged";
    case "acknowledged":
    case "dropped":
      return false;
  }
}

const adapter = createEntityAdapter<AlertEntity>({
  // ISO 8601 UTC strings sort correctly as plain strings. Newest first.
  sortComparer: (a, b) => b.eventTime.localeCompare(a.eventTime),
});

const alertsSlice = createSlice({
  name: "alerts",
  initialState: adapter.getInitialState(),
  reducers: {
    alertCreated(state, action: PayloadAction<Alert>) {
      adapter.addOne(state, {
        ...action.payload,
        status: "queued",
        attempts: 0,
      });
      // Bounded memory: ids are sorted newest first, so the tail is the oldest.
      const excess = state.ids.slice(limits.storedAlerts);
      if (excess.length > 0) adapter.removeMany(state, excess);
    },
    deliveryUpdated: {
      reducer(state, action: PayloadAction<DeliveryUpdate & { now: string }>) {
        const update = action.payload;
        const alert = state.entities[update.alertId];
        // Unknown ids happen legitimately (an alert evicted from the log); ignore them.
        if (!alert || !canTransition(alert.status, update.status)) return;

        alert.status = update.status;
        if (update.status === "sent") {
          alert.attempts += 1;
          alert.sentAt = update.now;
        } else if (update.status === "accepted") {
          alert.acceptedAt = update.receivedAt;
        } else if (update.status === "acknowledged") {
          alert.acknowledgement = { operator: update.operator, at: update.at };
        }
      },
      // The time is taken when the action is created, keeping the reducer pure.
      // RTK types prepare args loosely, so annotate `now` explicitly.
      prepare(update: DeliveryUpdate, now: string = new Date().toISOString()) {
        return { payload: { ...update, now } };
      },
    },
  },
});

export const { alertCreated, deliveryUpdated } = alertsSlice.actions;
export const alertsReducer = alertsSlice.reducer;

type AlertsRoot = { alerts: ReturnType<typeof alertsReducer> };

export const { selectAll: selectAllAlerts } = adapter.getSelectors<AlertsRoot>(
  (state) => state.alerts,
);

export const selectLoggedAlerts = createSelector([selectAllAlerts], (alerts) =>
  alerts.slice(0, limits.loggedAlerts),
);

export type AlertCounts = Record<DeliveryStatus, number> & { total: number };

export const selectAlertCounts = createSelector([selectAllAlerts], (alerts) => {
  const counts: AlertCounts = {
    total: alerts.length,
    queued: 0,
    sent: 0,
    accepted: 0,
    acknowledged: 0,
    dropped: 0,
  };
  for (const alert of alerts) counts[alert.status] += 1;
  return counts;
});

/** Crossing markers for the chart, keyed by the reading time (eventTime). */
export const selectChartMarkers = createSelector([selectAllAlerts], (alerts) =>
  alerts.map((a): ChartMarker => ({
    t: Date.parse(a.eventTime),
    direction: a.direction,
  })),
);
