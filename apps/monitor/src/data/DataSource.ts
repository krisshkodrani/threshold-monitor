import type { Reading } from "../domain/types";

export type { Reading };

/** A stream of readings. The app does not care where they come from. */
export interface DataSource {
  /** Returns the unsubscribe function. */
  subscribe(listener: (reading: Reading) => void): () => void;
  setRate(hz: number): void;
  pause(): void;
  resume(): void;
}

/** The subset of the timer API we use, injectable so tests can drive time. */
export type Scheduler = {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};
