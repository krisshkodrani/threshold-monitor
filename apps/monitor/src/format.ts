import { metric } from "./config";

/** Display helpers shared by the components. */

export const formatThreshold = (value: number) =>
  value.toFixed(metric.decimals);

export const formatReading = (value: number) =>
  value.toFixed(metric.readingDecimals);

export const withUnit = (text: string) => `${text} ${metric.unit}`;

const clock = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Local wall-clock time, e.g. "14:02:11". */
export const formatClock = (iso: string) => clock.format(new Date(iso));
