import type { AlertRecord } from "@app/protocol";
import { formatClock, formatThreshold, formatValue } from "../format";

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
  if (alarms.length === 0) {
    return <p className="muted">No alarms. New crossings appear here.</p>;
  }

  return (
    // Scrolls horizontally on narrow screens instead of squashing columns.
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Source</th>
            <th scope="col">Direction</th>
            <th scope="col">Value / threshold</th>
            <th scope="col">Acknowledgement</th>
          </tr>
        </thead>
        <tbody>
          {alarms.map((alarm) => {
            const pending = pendingAcks.includes(alarm.id);
            return (
              <tr
                key={alarm.id}
                className={alarm.acknowledgement ? undefined : "alarm--open"}
              >
                <td className="num">{formatClock(alarm.eventTime)}</td>
                <td>{alarm.sourceLabel}</td>
                <td>
                  <span aria-hidden="true">
                    {alarm.direction === "up" ? "▲" : "▼"}
                  </span>{" "}
                  {alarm.direction}
                </td>
                <td className="num">
                  {formatValue(alarm.value)} /{" "}
                  {formatThreshold(alarm.threshold)} {alarm.unit}
                </td>
                <td>
                  {alarm.acknowledgement ? (
                    <span className="chip chip--acknowledged">
                      Acknowledged by {alarm.acknowledgement.operator} at{" "}
                      {formatClock(alarm.acknowledgement.at)}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={!canAcknowledge || pending}
                      aria-label={`Acknowledge ${alarm.direction} crossing at ${formatClock(alarm.eventTime)} from ${alarm.sourceLabel}`}
                      onClick={() => onAcknowledge(alarm.id)}
                    >
                      {pending ? "Acknowledging…" : "Acknowledge"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
