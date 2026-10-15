import type { AlertRecord } from "@app/protocol";
import { DataTable, type Column } from "@app/ui";
import { formatClock, formatThreshold, formatValue } from "../format";

/** The columns that depend only on the alarm. */
const alarmColumns: Column<AlertRecord>[] = [
  {
    id: "time",
    header: "Time",
    width: "7.5rem",
    className: "num",
    cell: (alarm) => formatClock(alarm.eventTime),
  },
  {
    id: "source",
    header: "Source",
    width: "10rem",
    title: (alarm) => alarm.sourceLabel,
    cell: (alarm) => alarm.sourceLabel,
  },
  {
    id: "direction",
    header: "Direction",
    width: "8.5rem",
    cell: (alarm) => (
      <>
        <span aria-hidden="true">{alarm.direction === "up" ? "▲" : "▼"}</span>{" "}
        {alarm.direction}
      </>
    ),
  },
  {
    id: "value",
    header: "Value / threshold",
    width: "13.5rem",
    className: "num",
    cell: (alarm) => (
      <>
        {formatValue(alarm.value)} / {formatThreshold(alarm.threshold)}{" "}
        {alarm.unit}
      </>
    ),
  },
];

export function AlarmList({
  alarms,
  pendingAcks,
  canAcknowledge,
  onAcknowledge,
}: {
  alarms: readonly AlertRecord[];
  pendingAcks: readonly string[];
  canAcknowledge: boolean;
  onAcknowledge: (alertId: string) => void;
}) {
  // This column needs the props, so it is made on each render; that is cheap.
  const ackColumn: Column<AlertRecord> = {
    id: "acknowledgement",
    header: "Acknowledgement",
    cell: (alarm) => (
      // As high as the button, so the row keeps its height after the ack.
      <div className="ack-cell">
        {alarm.acknowledgement ? (
          <span
            className="chip chip--acknowledged"
            title={`Acknowledged by ${alarm.acknowledgement.operator}`}
          >
            Acknowledged by {alarm.acknowledgement.operator} at{" "}
            {formatClock(alarm.acknowledgement.at)}
          </span>
        ) : (
          <button
            type="button"
            disabled={!canAcknowledge || pendingAcks.includes(alarm.id)}
            aria-label={`Acknowledge ${alarm.direction} crossing at ${formatClock(alarm.eventTime)} from ${alarm.sourceLabel}`}
            onClick={() => onAcknowledge(alarm.id)}
          >
            {pendingAcks.includes(alarm.id) ? "Acknowledging…" : "Acknowledge"}
          </button>
        )}
      </div>
    ),
  };

  return (
    <DataTable
      rows={alarms}
      columns={[...alarmColumns, ackColumn]}
      rowKey={(alarm) => alarm.id}
      label="Scrollable alarm list"
      rowClassName={(alarm) =>
        alarm.acknowledgement ? undefined : "alarm--open"
      }
      minWidth="52rem"
      empty={<p className="muted">No alarms. New crossings appear here.</p>}
    />
  );
}
