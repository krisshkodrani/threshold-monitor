import type { ReadingsStore } from "../data/readingsStore";
import type { Side } from "../domain/types";
import { formatReading, formatThreshold, withUnit } from "../format";
import { useLatestReading } from "../hooks/useReadings";
import type { AlertCounts } from "../store/alertsSlice";

type Props = {
  readings: ReadingsStore;
  threshold: number;
  counts?: AlertCounts;
};

const sideLabels = { above: "▲ Above", below: "▼ Below" } as const;

export function ReadoutBar({ readings, threshold, counts }: Props) {
  // Subscribes itself, so a new reading re-renders only this bar and the chart.
  const latest = useLatestReading(readings);
  // The side of the latest value. The sensor's detector also uses the
  // hysteresis band; this view only says where the value is now.
  const side: Side | null = latest
    ? latest.value > threshold
      ? "above"
      : "below"
    : null;

  return (
    <dl className="readout">
      <div className="readout__item readout__item--primary">
        <dt>Current</dt>
        <dd className="readout__value">
          {latest ? withUnit(formatReading(latest.value)) : "—"}
        </dd>
      </div>
      <div className="readout__item">
        <dt>Threshold</dt>
        <dd>{withUnit(formatThreshold(threshold))}</dd>
      </div>
      <div className="readout__item">
        <dt>State</dt>
        <dd className={side ? `side side--${side}` : undefined}>
          {side ? sideLabels[side] : "—"}
        </dd>
      </div>
      {counts && (
        <>
          <div className="readout__item">
            <dt>Alerts</dt>
            <dd>{counts.total}</dd>
          </div>
          <div className="readout__item">
            <dt>Open</dt>
            <dd>{counts.received}</dd>
          </div>
          <div className="readout__item">
            <dt>Acknowledged</dt>
            <dd>{counts.acknowledged}</dd>
          </div>
        </>
      )}
    </dl>
  );
}
