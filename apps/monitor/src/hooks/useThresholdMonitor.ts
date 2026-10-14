import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type RefObject,
} from "react";
import { metric } from "../config";
import type { DataSource, Reading } from "../data/DataSource";
import type { ReadingsStore } from "../data/readingsStore";
import { createAlert } from "../domain/alert";
import { classify, step } from "../domain/crossing";
import type { DetectorState, Side } from "../domain/types";
import type { SourceIdentity } from "../identity";
import { alertCreated } from "../store/alertsSlice";
import { useAppDispatch, useAppSelector } from "../store";
import type { AlertTransport } from "../transport/AlertTransport";

export type ThresholdMonitorDeps = {
  source: DataSource;
  readings: ReadingsStore;
  transportRef: RefObject<AlertTransport | null>;
  identity: SourceIdentity;
  newId?: () => string;
};

/**
 * The one place where readings, the threshold and the transport meet.
 * It is also the only subscriber to the data source: it records each reading
 * in the readings store, which the chart reads, then runs detection.
 */
export function useThresholdMonitor({
  source,
  readings,
  transportRef,
  identity,
  newId = () => crypto.randomUUID(),
}: ThresholdMonitorDeps): { side: Side | null } {
  const dispatch = useAppDispatch();
  const cfg = useAppSelector((state) => state.threshold);
  const detector = useRef<DetectorState>({ side: null });
  const [side, setSide] = useState<Side | null>(null);

  // An Effect Event always sees the latest `cfg` without being a dependency,
  // so changing the threshold takes effect on the very next reading and does
  // not resubscribe to the source (no stale closure, no subscription churn).
  const onReading = useEffectEvent((reading: Reading) => {
    readings.push(reading);

    const [next, event] = step(detector.current, reading.value, cfg);
    detector.current = next;
    setSide(next.side); // React skips the render when the side is unchanged
    if (!event) return;

    const alert = createAlert(newId(), reading, event.direction, cfg, {
      sourceId: identity.sourceId,
      sourceLabel: identity.sourceLabel,
      metric: metric.key,
      unit: metric.unit,
    });
    dispatch(alertCreated(alert));
    transportRef.current?.send(alert);
  });

  useEffect(() => source.subscribe((reading) => onReading(reading)), [source]);

  // A configuration change re-derives the side from the latest value, silently.
  // Only a new reading can raise an alert, never a settings change (ADR 0003).
  useEffect(() => {
    detector.current = classify(readings.latest()?.value, cfg.threshold);
  }, [cfg.threshold, cfg.hysteresis, readings]);

  return { side };
}
