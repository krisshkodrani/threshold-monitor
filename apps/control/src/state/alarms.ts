import type { AlertRecord } from "@app/protocol";

export const MAX_ALARMS = 500;

export type AlarmsState = {
  /** Newest first (by server receipt time), unique by id, at most MAX_ALARMS. */
  alarms: readonly AlertRecord[];
  /** Alert ids with an `ack` sent and no answer yet, so the button cannot be pressed twice. */
  pendingAcks: readonly string[];
};

export type AlarmsAction =
  | { type: "welcomed"; recent: readonly AlertRecord[] }
  | { type: "alertReceived"; record: AlertRecord }
  | { type: "acknowledged"; alertId: string; operator: string; at: string }
  | { type: "ackSent"; alertId: string }
  | { type: "ackFailed"; alertId: string }
  | { type: "disconnected" }
  | { type: "cleared" };

export const initialAlarmsState: AlarmsState = { alarms: [], pendingAcks: [] };

/**
 * All alarm list rules in one pure function, so they are tested without React
 * or sockets. Messages can repeat (a reconnect replays `recent`), so every
 * case is idempotent, and an acknowledgement is never lost to an older copy.
 */
export function alarmsReducer(
  state: AlarmsState,
  action: AlarmsAction,
): AlarmsState {
  switch (action.type) {
    case "welcomed":
      // The server's list is the truth after a reconnect; keep what it no longer
      // holds (evicted or a server restart), so the operator does not lose context.
      return {
        alarms: merge(state.alarms, action.recent),
        pendingAcks: [],
      };
    case "alertReceived":
      return { ...state, alarms: merge(state.alarms, [action.record]) };
    case "acknowledged": {
      const acknowledgement = { operator: action.operator, at: action.at };
      return {
        alarms: state.alarms.map((alarm) =>
          alarm.id === action.alertId && !alarm.acknowledgement
            ? { ...alarm, acknowledgement }
            : alarm,
        ),
        pendingAcks: without(state.pendingAcks, action.alertId),
      };
    }
    case "ackSent":
      return state.pendingAcks.includes(action.alertId)
        ? state
        : { ...state, pendingAcks: [...state.pendingAcks, action.alertId] };
    case "ackFailed":
      return {
        ...state,
        pendingAcks: without(state.pendingAcks, action.alertId),
      };
    case "disconnected":
      // An ack in flight may or may not have arrived; the next welcome tells.
      return state.pendingAcks.length === 0
        ? state
        : { ...state, pendingAcks: [] };
    case "cleared":
      return {
        ...state,
        alarms: state.alarms.filter((alarm) => !alarm.acknowledgement),
      };
  }
}

export function unacknowledgedCount(state: AlarmsState): number {
  return state.alarms.filter((alarm) => !alarm.acknowledgement).length;
}

function merge(
  current: readonly AlertRecord[],
  incoming: readonly AlertRecord[],
): AlertRecord[] {
  const byId = new Map(current.map((alarm) => [alarm.id, alarm]));
  for (const record of incoming) {
    const known = byId.get(record.id);
    // An acknowledged copy always wins over an unacknowledged one.
    byId.set(
      record.id,
      known?.acknowledgement && !record.acknowledgement ? known : record,
    );
  }
  // ISO 8601 UTC strings sort correctly as plain strings.
  return [...byId.values()]
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, MAX_ALARMS);
}

function without(ids: readonly string[], id: string): readonly string[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : ids;
}
