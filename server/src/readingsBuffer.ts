import { WELCOME_READINGS_LIMIT, type ReadingValue } from "@app/protocol";

/**
 * The last readings of the sensor, in memory only, so a monitor that opens
 * has a full chart at once. Readings are not stored: they are many, and only
 * the alerts matter after a restart.
 */
export function createReadingsBuffer(capacity = WELCOME_READINGS_LIMIT) {
  let readings: ReadingValue[] = [];
  return {
    push(reading: ReadingValue) {
      readings.push(reading);
      if (readings.length > capacity) readings = readings.slice(-capacity);
    },
    /** Oldest first. */
    all: (): ReadingValue[] => [...readings],
    clear() {
      readings = [];
    },
  };
}

export type ReadingsBuffer = ReturnType<typeof createReadingsBuffer>;
