import type { AlertRecord } from "@app/protocol";
import {
  createEntityAdapter,
  createSelector,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";
import { limits } from "../config";
import type { ChartMarker } from "../domain/chartData";

/**
 * The sensor's alerts as the relay stored them (ADR 0009). The monitor only
 * shows them: "Received" until an operator acknowledges.
 */
export type AlertEntity = AlertRecord;

export type AlertStatus = "received" | "acknowledged";

export const statusOf = (alert: AlertEntity): AlertStatus =>
  alert.acknowledgement ? "acknowledged" : "received";

const adapter = createEntityAdapter<AlertEntity>({
  // ISO 8601 UTC strings sort correctly as plain strings. Newest first.
  sortComparer: (a, b) => b.eventTime.localeCompare(a.eventTime),
});

/** Bounded memory: ids are sorted newest first, so the tail is the oldest. */
function trim(state: ReturnType<typeof adapter.getInitialState>) {
  const excess = state.ids.slice(limits.storedAlerts);
  if (excess.length > 0) adapter.removeMany(state, excess);
}

const alertsSlice = createSlice({
  name: "alerts",
  initialState: adapter.getInitialState(),
  reducers: {
    /** The relay's recent alerts on each (re)connect replace the list. */
    welcomed(state, action: PayloadAction<AlertRecord[]>) {
      adapter.setAll(state, action.payload);
      trim(state);
    },
    alertReceived(state, action: PayloadAction<AlertRecord>) {
      // An acknowledged copy always wins over an older unacknowledged one.
      const existing = state.entities[action.payload.id];
      if (existing?.acknowledgement) return;
      adapter.upsertOne(state, action.payload);
      trim(state);
    },
    acknowledged(
      state,
      action: PayloadAction<{ alertId: string; operator: string; at: string }>,
    ) {
      const alert = state.entities[action.payload.alertId];
      // Unknown ids happen legitimately (an alert evicted from the log).
      if (!alert || alert.acknowledgement) return; // the first one wins
      alert.acknowledgement = {
        operator: action.payload.operator,
        at: action.payload.at,
      };
    },
  },
});

export const { welcomed, alertReceived, acknowledged } = alertsSlice.actions;
export const alertsReducer = alertsSlice.reducer;

type AlertsRoot = { alerts: ReturnType<typeof alertsReducer> };

export const { selectAll: selectAllAlerts } = adapter.getSelectors<AlertsRoot>(
  (state) => state.alerts,
);

export const selectLoggedAlerts = createSelector([selectAllAlerts], (alerts) =>
  alerts.slice(0, limits.loggedAlerts),
);

export type AlertCounts = Record<AlertStatus, number> & { total: number };

export const selectAlertCounts = createSelector([selectAllAlerts], (alerts) => {
  const counts: AlertCounts = {
    total: alerts.length,
    received: 0,
    acknowledged: 0,
  };
  for (const alert of alerts) counts[statusOf(alert)] += 1;
  return counts;
});

/** Crossing markers for the chart, keyed by the reading time (eventTime). */
export const selectChartMarkers = createSelector([selectAllAlerts], (alerts) =>
  alerts.map((a): ChartMarker => ({
    t: Date.parse(a.eventTime),
    direction: a.direction,
  })),
);
