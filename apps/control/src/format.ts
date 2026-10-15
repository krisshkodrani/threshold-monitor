const clock = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Local wall-clock time, e.g. "14:02:11". */
export const formatClock = (iso: string) => clock.format(new Date(iso));

/** The monitor rounds readings to 2 decimals and thresholds to 1. */
export const formatValue = (value: number) => value.toFixed(2);
export const formatThreshold = (value: number) => value.toFixed(1);
