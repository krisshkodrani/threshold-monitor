import type { SensorInfo, SettingsValue } from "@app/protocol";
import type { DataSource } from "./data/DataSource";
import { createAlert } from "./domain/alert";
import { classify, step } from "./domain/crossing";
import type { DetectorState } from "./domain/types";
import type { AlertTransport } from "./transport/AlertTransport";

export type AgentDeps = {
  source: DataSource;
  transport: AlertTransport;
  sensor: SensorInfo;
  metric: { key: string; unit: string };
  /** Used until the relay sends stored settings, and reported if it has none. */
  defaults: SettingsValue;
  newId?: () => string;
  onAlert?: (direction: "up" | "down", value: number) => void;
};

/**
 * The sensor's loop: each reading goes to the relay, then through the
 * detector; a crossing becomes an alert in the transport's outbox.
 * Before ADR 0009, each monitor tab did this; the rules are the same.
 */
export function startAgent({
  source,
  transport,
  sensor,
  metric,
  defaults,
  newId = () => crypto.randomUUID(),
  onAlert,
}: AgentDeps) {
  let cfg: SettingsValue = { ...defaults };
  // The settings the detector state was last classified against.
  let applied = cfg;
  let detector: DetectorState = { side: null };
  let lastValue: number | undefined;

  const stopSettings = transport.onSettings((stored) => {
    // The relay has none: our defaults become the shared settings.
    if (stored === null) return transport.reportSettings(cfg);
    cfg = { threshold: stored.threshold, hysteresis: stored.hysteresis };
  });

  const stopSource = source.subscribe((reading) => {
    // Settings changed since the last reading: re-derive the side from the
    // last value first, silently. Only a new reading can raise an alert,
    // never a settings change (ADR 0003).
    if (applied !== cfg) {
      applied = cfg;
      detector = classify(lastValue, cfg.threshold);
    }
    lastValue = reading.value;

    transport.sendReading({ t: Math.round(reading.t), value: reading.value });

    const [next, event] = step(detector, reading.value, cfg);
    detector = next;
    if (!event) return;

    transport.send(
      createAlert(newId(), reading, event.direction, cfg, {
        sourceId: sensor.sensorId,
        sourceLabel: sensor.label,
        metric: metric.key,
        unit: metric.unit,
      }),
    );
    onAlert?.(event.direction, reading.value);
  });

  return {
    /** The settings in use now. */
    settings: (): SettingsValue => cfg,
    stop() {
      stopSource();
      stopSettings();
    },
  };
}
