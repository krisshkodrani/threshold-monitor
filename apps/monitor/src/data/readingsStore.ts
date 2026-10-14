import { RingBuffer } from "../domain/window";
import type { Reading } from "./DataSource";

export type ReadingsStore = {
  push: (reading: Reading) => void;
  latest: () => Reading | undefined;
  subscribe: (listener: () => void) => () => void;
  /** Same array instance until the next push (see RingBuffer). */
  getSnapshot: () => readonly Reading[];
};

/**
 * The live readings window, kept outside Redux on purpose: at up to 10 Hz it
 * would flood the store and re-render every connected component. Components
 * read it through useSyncExternalStore, so only the chart and readout update.
 */
export function createReadingsStore(windowSize: number): ReadingsStore {
  const buffer = new RingBuffer<Reading>(windowSize);
  const listeners = new Set<() => void>();

  return {
    push(reading) {
      buffer.push(reading);
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
