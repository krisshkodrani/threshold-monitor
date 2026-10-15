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

/** Shown until the relay sends the shared settings (the sensor's defaults). */
export const defaults = {
  threshold: 25,
  hysteresis: 0.6,
};

/**
 * The chart keeps a fixed number of readings, not a fixed duration, so memory
 * is bounded. The visible span depends on the sensor's rate: 120 readings =
 * 2 min at 1/s, 12 s at 10/s. The relay keeps the same number (welcome).
 */
export const windowSize = 120;

export const hysteresisRange = { min: 0, max: 2, step: 0.1 } as const;

/** Alerts kept in memory and shown in the log. */
export const limits = { storedAlerts: 200, loggedAlerts: 50 } as const;
