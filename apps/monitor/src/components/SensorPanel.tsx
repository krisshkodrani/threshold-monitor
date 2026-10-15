import type { SensorInfo, SettingsRecord } from "@app/protocol";
import { windowSize } from "../config";
import { formatClock } from "../format";

/** Where the data comes from, and who changed the shared settings last. */
export function SensorPanel({
  sensor,
  settings,
}: {
  sensor: SensorInfo | null;
  settings: SettingsRecord | null;
}) {
  return (
    <div className="field">
      <p className="field__label">Sensor</p>
      <p className="field__hint">
        {sensor
          ? `${sensor.label} sends ${sensor.rateHz} readings each second. The chart shows the last ${windowSize} readings (${formatSpan(windowSize / sensor.rateHz)}).`
          : "No sensor is connected. The chart continues when it is back."}
      </p>
      <p className="field__hint">
        {settings === null
          ? "Waiting for the settings from the sensor."
          : settings.updatedBy
            ? `Settings changed by ${settings.updatedBy} at ${formatClock(settings.at)}.`
            : "The sensor's default settings."}
      </p>
    </div>
  );
}

function formatSpan(seconds: number): string {
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`;
}
