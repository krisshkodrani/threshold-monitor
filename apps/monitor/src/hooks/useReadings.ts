import { useSyncExternalStore } from "react";
import type { Reading } from "../data/DataSource";
import type { ReadingsStore } from "../data/readingsStore";

/**
 * The live readings window. Only components that call this re-render on each
 * reading. useSyncExternalStore guarantees every component sees the same
 * snapshot in a render (no tearing), which a ref or context would not.
 */
export function useReadings(readings: ReadingsStore): readonly Reading[] {
  return useSyncExternalStore(readings.subscribe, readings.getSnapshot);
}

/** Just the newest reading (the same object until the next one arrives). */
export function useLatestReading(readings: ReadingsStore): Reading | undefined {
  return useSyncExternalStore(readings.subscribe, readings.latest);
}
