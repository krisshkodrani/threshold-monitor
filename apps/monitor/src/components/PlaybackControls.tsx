import { useId } from "react";
import { rateOptions } from "../config";

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
  return (
    <div className="field">
      <label htmlFor={rateId}>Readings per second</label>
      <div className="field__row">
        <select
          id={rateId}
          value={rateHz}
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
    </div>
  );
}
