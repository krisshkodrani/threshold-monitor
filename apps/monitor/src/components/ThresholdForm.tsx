import { useId, useState, type FormEvent } from "react";
import { metric } from "../config";
import { parseThresholdInput } from "../domain/thresholdInput";
import { formatThreshold, withUnit } from "../format";

type Props = {
  /** The active threshold. Render with `key={threshold}` so a new value resets the draft. */
  threshold: number;
  onCommit: (value: number) => void;
};

/**
 * Commits on Enter, Apply or blur, never per keystroke: typing "25" must not
 * briefly set the threshold to 2 (which would also re-classify the detector).
 */
export function ThresholdForm({ threshold, onCommit }: Props) {
  const [draft, setDraft] = useState(() => formatThreshold(threshold));
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const activeId = useId();

  function commit() {
    const result = parseThresholdInput(draft, metric);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setDraft(formatThreshold(result.value));
    if (result.value !== threshold) onCommit(result.value);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    commit();
  }

  const showActive = draft.trim() !== formatThreshold(threshold);
  const describedBy = [error && errorId, showActive && activeId]
    .filter(Boolean)
    .join(" ");

  return (
    <form className="field" onSubmit={handleSubmit} noValidate>
      <label htmlFor={inputId}>Threshold ({metric.unit})</label>
      <div className="field__row">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          aria-invalid={error !== null}
          aria-describedby={describedBy || undefined}
        />
        <button type="submit">Apply</button>
      </div>
      {error && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}
      {showActive && (
        <p id={activeId} className="field__hint">
          Active: {withUnit(formatThreshold(threshold))}
        </p>
      )}
    </form>
  );
}
