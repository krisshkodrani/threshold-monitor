import { useId, useState, type FormEvent } from "react";
import { MAX_OPERATOR_LENGTH, normalizeOperator } from "../operator";

/** The name recorded with every acknowledgement. Required before acknowledging. */
export function OperatorForm({
  operator,
  onSave,
}: {
  operator: string | null;
  onSave: (name: string) => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState(operator ?? "");
  const [touched, setTouched] = useState(false);
  const valid = normalizeOperator(draft);
  const invalid = touched && valid === null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (valid !== null) onSave(valid);
  }

  return (
    <form className="field" onSubmit={submit} noValidate>
      <label htmlFor={inputId}>Operator name</label>
      <div className="field__row">
        <input
          id={inputId}
          type="text"
          value={draft}
          maxLength={MAX_OPERATOR_LENGTH}
          autoComplete="name"
          aria-invalid={invalid}
          aria-describedby={hintId}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit">Save</button>
      </div>
      <p id={hintId} className={invalid ? "field__error" : "field__hint"}>
        {invalid
          ? `Enter 1 to ${MAX_OPERATOR_LENGTH} characters.`
          : operator
            ? `Acknowledging as ${operator}.`
            : "Enter your name to acknowledge alarms."}
      </p>
    </form>
  );
}
