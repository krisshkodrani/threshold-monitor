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

export function AlertLog({ alerts }: { alerts: readonly AlertEntity[] }) {
  const headingId = useId();
  return (
    <section className="panel" aria-labelledby={headingId}>
      <h2 id={headingId}>
        Alert log{" "}
        {alerts.length > 0 && (
          <span className="heading__count">
            · {alerts.length} {alerts.length === 1 ? "alert" : "alerts"}
          </span>
        )}
      </h2>
      {alerts.length === 0 ? (
        <p className="muted">
          No crossings yet. Move the threshold close to the current value.
        </p>
      ) : (
        // A box with a fixed height: the rows scroll inside it, and the header
        // row stays visible. Focusable, so keyboard users can scroll it too.
        <div
          className="table-scroll table-scroll--rows"
          role="region"
          aria-label="Scrollable alert log"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Direction</th>
                <th scope="col">Value / threshold</th>
                <th scope="col">Status</th>
                <th scope="col">Latency</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.id}>
                  <td className="num">{formatClock(alert.eventTime)}</td>
                  <td>
                    <span aria-hidden="true">
                      {alert.direction === "up" ? "▲" : "▼"}
                    </span>{" "}
                    {alert.direction}
                  </td>
                  <td className="num">
                    {formatReading(alert.value)} /{" "}
                    {formatThreshold(alert.threshold)} {alert.unit}
                  </td>
                  <td>
                    <span className={`chip chip--${alert.status}`}>
                      {statusText(alert)}
                    </span>
                    {alert.attempts > 1 && (
                      <span className="muted">
                        {" "}
                        · {alert.attempts} attempts
                      </span>
                    )}
                  </td>
                  <td className="num">{latency(alert)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
