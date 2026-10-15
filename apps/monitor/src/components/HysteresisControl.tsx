import { useId } from "react";
import { hysteresisRange, metric } from "../config";

type Props = {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
};

export function HysteresisControl({
  value,
  onChange,
  disabled = false,
}: Props) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>Hysteresis band ({metric.unit})</label>
      <div className="field__row">
        <input
          id={id}
          type="range"
          min={hysteresisRange.min}
          max={hysteresisRange.max}
          step={hysteresisRange.step}
          value={value}
          disabled={disabled}
          // Round away float noise such as 0.30000000000000004 from the slider.
          onChange={(event) =>
            onChange(Math.round(Number(event.target.value) * 10) / 10)
          }
        />
        <output htmlFor={id}>{value.toFixed(1)}</output>
      </div>
      <p className="field__hint">
        Alerts need to clear ±{(value / 2).toFixed(2)} around the threshold.
      </p>
    </div>
  );
}
