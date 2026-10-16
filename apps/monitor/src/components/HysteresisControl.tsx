import { useId, useState } from "react";
import { hysteresisRange, metric } from "../config";

type Props = {
  /** The shared hysteresis. It changes when the relay confirms a change. */
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
};

/**
 * The slider shows a local draft during a drag and sends the value only on
 * release (pointer up, key up or blur). Otherwise the thumb jumps back to
 * the shared value until the relay answers, and each step sends a message.
 */
export function HysteresisControl({
  value,
  onChange,
  disabled = false,
}: Props) {
  const id = useId();
  const [draft, setDraft] = useState<number | null>(null);
  // A new shared value replaces the draft (React's "adjust state when a prop
  // changes" pattern, no effect): the relay confirmed this change or another.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(null);
  }
  const current = draft ?? value;

  function commit() {
    if (draft === null) return;
    if (draft === value) setDraft(null);
    else onChange(draft);
  }

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
          value={current}
          disabled={disabled}
          // Round away float noise such as 0.30000000000000004 from the slider.
          onChange={(event) =>
            setDraft(Math.round(Number(event.target.value) * 10) / 10)
          }
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <output htmlFor={id}>{current.toFixed(1)}</output>
      </div>
      <p className="field__hint">
        Alerts need to clear ±{(current / 2).toFixed(2)} around the threshold.
      </p>
    </div>
  );
}
