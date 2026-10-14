import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Reading } from "./DataSource";
import { createRandomWalkSource } from "./randomWalkSource";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(rateHz = 2) {
  const source = createRandomWalkSource({
    seed: 1,
    rateHz,
    clock: () => Date.now(),
  });
  const readings: Reading[] = [];
  return {
    source,
    readings,
    listen: () => source.subscribe((r) => readings.push(r)),
  };
}

describe("randomWalkSource", () => {
  test("emits nothing until someone subscribes", () => {
    setup();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("emits at the configured rate", () => {
    const { readings, listen } = setup(2);
    listen();
    vi.advanceTimersByTime(2000);
    expect(readings).toHaveLength(4);
    expect(readings[1]!.t - readings[0]!.t).toBe(500);
  });

  test("the last unsubscribe stops the timer", () => {
    const { source, readings, listen } = setup();
    const stop = listen();
    const stopOther = source.subscribe(() => {});
    stop();
    expect(vi.getTimerCount()).toBe(1);
    stopOther();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(readings).toHaveLength(0);
  });

  test("unsubscribing twice is harmless", () => {
    const { listen } = setup();
    const stop = listen();
    stop();
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("pause stops readings and resume restarts them", () => {
    const { source, readings, listen } = setup(1);
    listen();
    source.pause();
    vi.advanceTimersByTime(3000);
    expect(readings).toHaveLength(0);
    source.resume();
    vi.advanceTimersByTime(3000);
    expect(readings).toHaveLength(3);
  });

  test("setRate changes the interval without adding a second timer", () => {
    const { source, readings, listen } = setup(1);
    listen();
    source.setRate(10);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(readings).toHaveLength(10);
  });

  test("the same seed produces the same values", () => {
    const a = setup();
    const b = setup();
    a.listen();
    b.listen();
    vi.advanceTimersByTime(5000);
    expect(a.readings.map((r) => r.value)).toEqual(
      b.readings.map((r) => r.value),
    );
  });
});
