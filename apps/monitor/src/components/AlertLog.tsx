import { DataTable, type Column } from "@app/ui";
import { useId } from "react";
import { formatClock, formatReading, formatThreshold } from "../format";
import type { AlertEntity } from "../store/alertsSlice";

export function statusText(alert: AlertEntity): string {
  switch (alert.status) {
    case "queued":
      return "Queued";
    case "sent":
      return "Sent";
    case "accepted":
      return "Accepted";
    case "acknowledged":
      return `Acknowledged by ${alert.acknowledgement?.operator ?? "operator"}`;
    case "dropped":
      return "Dropped";
  }
}

/**
 * From the reading to this tab learning the server stored it. Both times come
 * from the browser clock: mixing in the server's `acceptedAt` would add any
 * clock difference between the two machines, even making latency negative.
 */
function latency(alert: AlertEntity): string {
  if (!alert.acceptedLocalAt) return "—";
  return `${Date.parse(alert.acceptedLocalAt) - Date.parse(alert.eventTime)} ms`;
}

/** What each column shows. The shared DataTable does the layout and scrolling. */
const columns: Column<AlertEntity>[] = [
  {
    id: "time",
    header: "Time",
    width: "7.5rem",
    className: "num",
    cell: (alert) => formatClock(alert.eventTime),
  },
  {
    id: "direction",
    header: "Direction",
    width: "8rem",
    cell: (alert) => (
      <>
        <span aria-hidden="true">{alert.direction === "up" ? "▲" : "▼"}</span>{" "}
        {alert.direction}
      </>
    ),
  },
  {
    id: "value",
    header: "Value / threshold",
    width: "11rem",
    className: "num",
    cell: (alert) => (
      <>
        {formatReading(alert.value)} / {formatThreshold(alert.threshold)}{" "}
        {alert.unit}
      </>
    ),
  },
  {
    id: "status",
    header: "Status",
    title: statusText,
    cell: (alert) => (
      <>
        <span className={`chip chip--${alert.status}`}>
          {statusText(alert)}
        </span>
        {alert.attempts > 1 && (
          <span className="muted"> · {alert.attempts} attempts</span>
        )}
      </>
    ),
  },
  {
    id: "latency",
    header: "Latency",
    width: "6.5rem",
    className: "num",
    cell: latency,
  },
];

export function AlertLog({ alerts }: { alerts: readonly AlertEntity[] }) {
  const headingId = useId();
  return (
    <section className="panel alert-log" aria-labelledby={headingId}>
      <h2 id={headingId}>
        Alert log{" "}
        {alerts.length > 0 && (
          <span className="heading__count">
            · {alerts.length} {alerts.length === 1 ? "alert" : "alerts"}
          </span>
        )}
      </h2>
      <DataTable
        rows={alerts}
        columns={columns}
        rowKey={(alert) => alert.id}
        label="Scrollable alert log"
        minWidth="40rem"
        empty={
          <p className="muted">
            No crossings yet. Move the threshold close to the current value.
          </p>
        }
      />
    </section>
  );
}
