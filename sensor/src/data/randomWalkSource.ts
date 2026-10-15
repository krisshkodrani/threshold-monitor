import { createRandomWalk } from "../domain/randomWalk";
import type { DataSource, Reading, Scheduler } from "./DataSource";

export type RandomWalkSourceOptions = {
  seed: number;
  rateHz: number;
  scheduler?: Scheduler;
  clock?: () => number;
};

/**
 * After a long time in a hidden tab, only the last minute is made up. At
 * 10 readings each second that is 600 readings, which the app handles in one
 * go; older readings are skipped (a gap in the data).
 */
export const MAX_CATCH_UP_MS = 60_000;

const browserScheduler: Scheduler = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * Emits random-walk readings at the configured rate. The timer only runs while
 * someone is listening and playback is not paused, so creating a source has no
 * side effects and the last unsubscribe stops all timers.
 *
 * The clock, not the number of timer ticks, decides how many readings are due.
 * Browsers slow timers in hidden tabs (to 1 each second, later 1 each minute),
 * so a tick can be late: it then emits every reading that is due, each with
 * its own scheduled time. The data has no gap, and crossings are still found.
 */
export function createRandomWalkSource({
  seed,
  rateHz,
  scheduler = browserScheduler,
  clock = Date.now,
}: RandomWalkSourceOptions): DataSource {
  const next = createRandomWalk({ seed });
  const listeners = new Set<(reading: Reading) => void>();
  let rate = rateHz;
  let paused = false;
  let timer: unknown = null;
  let nextAt = 0; // the scheduled time of the next reading

  function tick() {
    const now = clock();
    const period = 1000 / rate;
    if (now - nextAt > MAX_CATCH_UP_MS) {
      // Keep the schedule's phase, but start at most MAX_CATCH_UP_MS back.
      nextAt += Math.floor((now - MAX_CATCH_UP_MS - nextAt) / period) * period;
    }
    while (nextAt <= now) {
      const reading = { t: nextAt, value: next() };
      for (const listener of listeners) listener(reading);
      nextAt += period;
    }
  }

  // Single place that decides whether the timer should run, so it can never
  // be started twice or left running.
  function sync() {
    if (timer !== null) {
      scheduler.clearInterval(timer);
      timer = null;
    }
    if (listeners.size > 0 && !paused) {
      // A new schedule: a pause or a rate change is never made up.
      nextAt = clock() + 1000 / rate;
      timer = scheduler.setInterval(tick, 1000 / rate);
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) sync();
      return () => {
        if (listeners.delete(listener) && listeners.size === 0) sync();
      };
    },
    setRate(hz) {
      rate = hz;
      sync();
    },
    pause() {
      paused = true;
      sync();
    },
    resume() {
      paused = false;
      sync();
    },
  };
}
