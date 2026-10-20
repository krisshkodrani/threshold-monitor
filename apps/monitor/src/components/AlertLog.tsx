import { DataTable, ErrorBoundary, type Column } from "@app/ui";
import { useId } from "react";
import { formatClock, formatReading, formatThreshold } from "../format";
import {
  statusOf,
  type AlertEntity,
  type AlertCounts,
} from "../store/alertsSlice";

export function statusText(alert: AlertEntity): string {
  return alert.acknowledgement
    ? `Acknowledged by ${alert.acknowledgement.operator}`
    : "Received";
}

/**
 * From the reading at the sensor to the relay storing the alert. Both clocks
 * are on the backend, so the browser clock does not matter here.
 */
function latency(alert: AlertEntity): string {
  return `${Date.parse(alert.receivedAt) - Date.parse(alert.eventTime)} ms`;
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
        <span className={`chip chip--${statusOf(alert)}`}>
          {statusText(alert)}
        </span>
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

export function AlertLog({
  alerts,
  counts,
}: {
  alerts: readonly AlertEntity[];
  counts?: AlertCounts;
}) {
  const headingId = useId();
  return (
    <section className="panel alert-log" aria-labelledby={headingId}>
      <div className="alert-log__heading">
        <h2 id={headingId}>
          Alert log{" "}
          {alerts.length > 0 && (
            <span className="heading__count">
              · {alerts.length} {alerts.length === 1 ? "alert" : "alerts"}
            </span>
          )}
        </h2>
        {counts && (
          <dl className="alert-summary">
            <div>
              <dt>Alerts</dt>
              <dd>{counts.total}</dd>
            </div>
            <div>
              <dt>Open</dt>
              <dd>{counts.received}</dd>
            </div>
            <div>
              <dt>Acknowledged</dt>
              <dd>{counts.acknowledged}</dd>
            </div>
          </dl>
        )}
      </div>
      <ErrorBoundary name="The alert log">
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
      </ErrorBoundary>
    </section>
  );
}
