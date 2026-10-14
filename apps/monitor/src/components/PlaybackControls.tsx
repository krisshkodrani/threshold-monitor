import { useId } from "react";
import { defaults, rateOptions } from "../config";

type Props = {
  paused: boolean;
  rateHz: number;
  onTogglePause: () => void;
  onRateChange: (hz: number) => void;
};

export function PlaybackControls({
  paused,
  rateHz,
  onTogglePause,
  onRateChange,
}: Props) {
  const rateId = useId();
  const hintId = useId();
  // The window is a reading count, so its duration depends on the rate (see config).
  const windowSeconds = defaults.windowSize / rateHz;

  return (
    <div className="field">
      <label htmlFor={rateId}>Readings per second</label>
      <div className="field__row">
        <select
          id={rateId}
          value={rateHz}
          aria-describedby={hintId}
          onChange={(event) => onRateChange(Number(event.target.value))}
        >
          {rateOptions.map((rate) => (
            <option key={rate} value={rate}>
              {rate} / s
            </option>
          ))}
        </select>
        <button type="button" onClick={onTogglePause}>
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>
      </div>
      <p id={hintId} className="field__hint">
        {`The chart shows the last ${defaults.windowSize} readings (${windowSeconds} s).`}
      </p>
    </div>
  );
}
