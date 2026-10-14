export type ValueRange = {
  min: number;
  max: number;
  decimals: number;
  unit: string;
  /** Used in messages, e.g. "temperature" -> "Enter a temperature." */
  noun: string;
};

export type ThresholdInputResult =
  { ok: true; value: number } | { ok: false; error: string };

// Optional sign, digits, optional decimal part with "." or ",". Deliberately
// stricter than Number(): it rejects "1e3", "0x10", "Infinity" and stray text.
const NUMBER_PATTERN = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

/** Turns what the user typed into a valid threshold, or a message saying how to fix it. */
export function parseThresholdInput(
  raw: string,
  range: ValueRange,
): ThresholdInputResult {
  const text = raw.trim().replace("−", "-"); // accept the typographic minus "−"
  if (text === "") return { ok: false, error: `Enter a ${range.noun}.` };
  if (!NUMBER_PATTERN.test(text)) {
    return { ok: false, error: "Use a number such as 25.5." };
  }

  // Comma decimals are normal in German speaking countries: "25,5".
  const factor = 10 ** range.decimals;
  // `+ 0` turns -0 (from e.g. "-0.01") into 0, so it never displays as "-0".
  const value =
    Math.round(Number(text.replace(",", ".")) * factor) / factor + 0;

  if (value < range.min || value > range.max) {
    return {
      ok: false,
      error: `Keep it between ${formatNumber(range.min)} and ${formatNumber(range.max)} ${range.unit}.`,
    };
  }
  return { ok: true, value };
}

/** Uses the typographic minus sign for display, as in the spec's messages. */
function formatNumber(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : String(n);
}
