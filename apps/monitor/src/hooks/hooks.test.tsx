import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { DataSource } from "../data/DataSource";
import { createRandomWalkSource } from "../data/randomWalkSource";
import { createReadingsStore } from "../data/readingsStore";
import { createAppStore } from "../store";
import { hysteresisChanged, thresholdCommitted } from "../store/thresholdSlice";
import { FakeSource, fakeTransportFactory } from "../test/fakes";
import { useThresholdMonitor } from "./useThresholdMonitor";
import { useTransport } from "./useTransport";

const identity = { sourceId: "source-1", sourceLabel: "Monitor TST" };
const WINDOW = 120;

/** Mounts both hooks the way App does, under StrictMode. Threshold 25, hysteresis 1. */
function mount(source: DataSource = new FakeSource()) {
  const store = createAppStore({ threshold: { threshold: 25, hysteresis: 1 } });
  const readings = createReadingsStore(WINDOW);
  const transports = fakeTransportFactory();
  let nextId = 0;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(
    () => {
      const transportRef = useTransport(transports.create);
      return useThresholdMonitor({
        source,
        readings,
        transportRef,
        identity,
        newId: () => `alert-${++nextId}`,
      });
    },
    { wrapper, reactStrictMode: true },
  );

  const sent = () => transports.alive().flatMap((t) => t.sent);
  return { store, readings, transports, hook, sent };
}

describe("under StrictMode", () => {
  test("exactly one transport and one source subscription are alive", () => {
    const source = new FakeSource();
    const { transports } = mount(source);
    // StrictMode mounted twice: the first transport must already be disposed.
    expect(transports.created.length).toBeGreaterThanOrEqual(1);
    expect(transports.alive()).toHaveLength(1);
    expect(source.listenerCount).toBe(1);
  });

  test("each crossing is sent exactly once", () => {
    const source = new FakeSource();
    const { sent, store } = mount(source);
    act(() => source.emit(20, 26));
    expect(sent()).toHaveLength(1);
    expect(Object.keys(store.getState().alerts.entities)).toHaveLength(1);
  });
});

describe("threshold changes", () => {
  test("the next reading uses a threshold changed mid-stream (no stale closure)", () => {
    const source = new FakeSource();
    const { sent, store } = mount(source);
    act(() => source.emit(20));
    act(() => {
      store.dispatch(thresholdCommitted(30));
    });

    act(() => source.emit(26)); // would cross the old threshold of 25
    expect(sent()).toHaveLength(0);

    act(() => source.emit(31)); // crosses the new threshold of 30
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      threshold: 30,
      value: 31,
      direction: "up",
    });
  });

  test("moving the threshold across the current value never alerts", () => {
    const source = new FakeSource();
    const { sent, store } = mount(source);
    act(() => source.emit(28)); // above 25

    act(() => {
      store.dispatch(thresholdCommitted(32)); // now the value is below it
      store.dispatch(hysteresisChanged(2));
      store.dispatch(thresholdCommitted(20)); // and above it again
    });
    act(() => source.emit(28, 28.2));
    expect(sent()).toHaveLength(0);

    // Real crossings still work afterwards.
    act(() => source.emit(18.9));
    expect(sent()).toHaveLength(1);
    expect(sent()[0]?.direction).toBe("down");
  });

  test("the readout side follows a threshold change immediately, without a new reading", () => {
    const source = new FakeSource();
    const { hook, store } = mount(source);
    act(() => source.emit(26));
    expect(hook.result.current.side).toBe("above");

    act(() => {
      store.dispatch(thresholdCommitted(30));
    });
    expect(hook.result.current.side).toBe("below");
  });

  test("the first reading after a threshold change is judged from the re-derived side", () => {
    const source = new FakeSource();
    const { sent, store } = mount(source);
    act(() => source.emit(26)); // above 25
    act(() => {
      store.dispatch(thresholdCommitted(30));
    });
    // With the stale side ("above") and the new band (29.5 .. 30.5), 26.1 would
    // look like a down crossing. Re-deriving first makes it "below": no alert.
    act(() => source.emit(26.1));
    expect(sent()).toHaveLength(0);
  });

  test("exposes the current side for the readout", () => {
    const source = new FakeSource();
    const { hook } = mount(source);
    expect(hook.result.current.side).toBeNull();
    act(() => source.emit(26));
    expect(hook.result.current.side).toBe("above");
  });
});

describe("cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("after unmount no timers run, nothing is read or sent, the transport is disposed", () => {
    const source = createRandomWalkSource({ seed: 123, rateHz: 10 });
    const { hook, readings, transports } = mount(source);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    const readingsBefore = readings.latest();
    const sentBefore = transports.created.flatMap((t) => t.sent).length;
    expect(sentBefore).toBeGreaterThan(0); // the seed does cross the threshold

    hook.unmount();
    expect(transports.alive()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(readings.latest()).toBe(readingsBefore);
    expect(transports.created.flatMap((t) => t.sent)).toHaveLength(sentBefore);
  });
});

test("memory stays bounded: 10 000 readings keep only the window", () => {
  const source = new FakeSource();
  const { readings } = mount(source);
  act(() => {
    for (let i = 0; i < 10_000; i++) source.emit(20 + (i % 10));
  });
  expect(readings.getSnapshot()).toHaveLength(WINDOW);
});
