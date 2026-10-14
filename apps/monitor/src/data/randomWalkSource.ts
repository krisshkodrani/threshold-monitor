import { createRandomWalk } from "../domain/randomWalk";
import type { DataSource, Reading, Scheduler } from "./DataSource";

export type RandomWalkSourceOptions = {
  seed: number;
  rateHz: number;
  scheduler?: Scheduler;
  clock?: () => number;
};

const browserScheduler: Scheduler = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * Emits one random-walk reading per tick. The timer only runs while someone is
 * listening and playback is not paused, so creating a source has no side
 * effects and the last unsubscribe stops all timers.
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

  function tick() {
    const reading = { t: clock(), value: next() };
    for (const listener of listeners) listener(reading);
  }

  // Single place that decides whether the timer should run, so it can never
  // be started twice or left running.
  function sync() {
    if (timer !== null) {
      scheduler.clearInterval(timer);
      timer = null;
    }
    if (listeners.size > 0 && !paused) {
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
