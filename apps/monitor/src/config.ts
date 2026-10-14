/**
 * Everything specific to "temperature" lives here. The domain code only knows
 * about a generic `value`, so swapping the data source means editing this file.
 */
export const metric = {
  key: "temperature",
  label: "Temperature",
  noun: "temperature",
  unit: "°C",
  min: -40, // valid threshold range
  max: 80,
  decimals: 1, // threshold precision
  readingDecimals: 2, // the generator rounds readings to 2 decimals
} as const;

export const defaults = {
  threshold: 25,
  hysteresis: 0.6,
  rateHz: 2,
  // The chart keeps a fixed number of readings, not a fixed duration, so memory
  // is bounded independently of the rate. The visible time span therefore
  // depends on the rate: 120 readings = 2 min at 1/s, 12 s at 10/s.
  windowSize: 120,
  seed: 20261014,
};

/** Readings per second offered in the UI. */
export const rateOptions = [1, 2, 5, 10] as const;

export const hysteresisRange = { min: 0, max: 2, step: 0.1 } as const;

/** Alerts kept in memory and shown in the log. */
export const limits = { storedAlerts: 200, loggedAlerts: 50 } as const;
