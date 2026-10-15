import { RingBuffer } from "../domain/window";
import type { Reading } from "../domain/types";

export type ReadingsStore = {
  push: (reading: Reading) => void;
  /** Replaces the window, for example with the relay's last readings on welcome. */
  reset: (readings: readonly Reading[]) => void;
  latest: () => Reading | undefined;
  subscribe: (listener: () => void) => () => void;
  /** Same array instance until the next push (see RingBuffer). */
  getSnapshot: () => readonly Reading[];
};

/**
 * The live readings window from the sensor, kept outside Redux on purpose: at up to 10 Hz it
 * would flood the store and re-render every connected component. Components
 * read it through useSyncExternalStore, so only the chart and readout update.
 */
export function createReadingsStore(windowSize: number): ReadingsStore {
  let buffer = new RingBuffer<Reading>(windowSize);
  const listeners = new Set<() => void>();

  return {
    push(reading) {
      buffer.push(reading);
      for (const listener of listeners) listener();
    },
    reset(readings) {
      buffer = new RingBuffer<Reading>(windowSize);
      for (const reading of readings) buffer.push(reading);
      for (const listener of listeners) listener();
    },
    latest: () => buffer.toArray().at(-1),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => buffer.toArray(),
  };
}
