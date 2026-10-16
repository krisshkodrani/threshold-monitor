import { createRandomWalk } from "../domain/randomWalk";
import type { DataSource, Reading, Scheduler } from "./DataSource";

export type RandomWalkSourceOptions = {
  seed: number;
  rateHz: number;
  scheduler?: Scheduler;
  clock?: () => number;
};

/**
 * After a long stop of the process (for example, a suspended computer), only
 * the last minute is made up. At 10 readings each second that is 600
 * readings, which the agent handles in one go; older readings are skipped
 * (a gap in the data).
 */
export const MAX_CATCH_UP_MS = 60_000;

const timerScheduler: Scheduler = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * Emits random-walk readings at the configured rate. The timer runs only
 * while the source has a listener and is not paused. Thus, a new source has
 * no side effects, and the last unsubscribe stops all timers.
 *
 * The clock, not the number of timer ticks, decides how many readings are due.
 * A tick can be late (a busy event loop, a suspended process). It then emits
 * each reading that is due, with its own scheduled time. The data has no gap,
 * and the detector still finds the crossings.
 */
export function createRandomWalkSource({
  seed,
  rateHz,
  scheduler = timerScheduler,
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

  // One place decides if the timer runs. Thus, the timer cannot start two
  // times, and it cannot continue after the last listener goes.
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
