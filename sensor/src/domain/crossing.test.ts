import { describe, expect, test } from "vitest";
import { classify, step } from "./crossing";
import type { CrossingEvent, DetectorConfig, DetectorState } from "./types";

const cfg: DetectorConfig = { threshold: 25, hysteresis: 1 }; // band 24.5 .. 25.5

/** Feeds values through the detector and returns the event (or null) per value. */
function run(
  values: number[],
  config: DetectorConfig = cfg,
  initial: DetectorState = { side: null },
) {
  let state = initial;
  const events: (CrossingEvent["direction"] | null)[] = [];
  for (const value of values) {
    const [next, event] = step(state, value, config);
    state = next;
    events.push(event?.direction ?? null);
  }
  return { state, events };
}

describe("step", () => {
  test.each([
    ["above", 30],
    ["below", 20],
    ["inside the band", 25.2],
  ])("the first reading never alerts (%s)", (_label, value) => {
    expect(run([value]).events).toEqual([null]);
  });

  test("the first reading sets the side by comparing with the threshold", () => {
    expect(run([25.2]).state).toEqual({ side: "above" });
    expect(run([25]).state).toEqual({ side: "below" });
  });

  test("rising past the upper band edge alerts up", () => {
    expect(run([20, 25.6]).events).toEqual([null, "up"]);
  });

  test("falling past the lower band edge alerts down", () => {
    expect(run([30, 24.4]).events).toEqual([null, "down"]);
  });

  test.each([
    ["the threshold", 25],
    ["the upper edge", 25.5],
  ])("from below, a value exactly at %s does not switch", (_label, value) => {
    expect(run([20, value])).toEqual({
      state: { side: "below" },
      events: [null, null],
    });
  });

  test.each([
    ["the threshold", 25],
    ["the lower edge", 24.5],
  ])("from above, a value exactly at %s does not switch", (_label, value) => {
    expect(run([30, value])).toEqual({
      state: { side: "above" },
      events: [null, null],
    });
  });

  test("noise inside the band after rising does not flap", () => {
    const { events } = run([20, 26, 24.9, 25.4, 24.6, 25.1, 24.5]);
    expect(events).toEqual([null, "up", null, null, null, null, null]);
  });

  test("a full cycle alerts once per real crossing", () => {
    const { events } = run([20, 26, 25, 24, 25, 26]);
    expect(events).toEqual([null, "up", null, "down", null, "up"]);
  });

  test("with zero hysteresis it is a plain crossing detector", () => {
    const plain = { threshold: 25, hysteresis: 0 };
    expect(run([24.9, 25.1, 25, 24.9, 25.01], plain).events).toEqual([
      null,
      "up",
      null,
      "down",
      "up",
    ]);
  });

  test.each([NaN, Infinity, -Infinity])(
    "ignores %s and keeps the current side",
    (bad) => {
      expect(run([20, bad, 26]).events).toEqual([null, null, "up"]);
      // A bad first reading must not count as "having seen a reading".
      expect(run([bad, 30]).events).toEqual([null, null]);
    },
  );
});

describe("classify", () => {
  test("returns the side for a finite value", () => {
    expect(classify(30, 25)).toEqual({ side: "above" });
    expect(classify(25, 25)).toEqual({ side: "below" });
  });

  test("returns no side when there is no usable value", () => {
    expect(classify(undefined, 25)).toEqual({ side: null });
    expect(classify(NaN, 25)).toEqual({ side: null });
  });

  test("raising the threshold above the current value is silent; the next real crossing alerts", () => {
    // Above 25 at 26. The user raises the threshold to 28: no event is possible from classify.
    const raised = { threshold: 28, hysteresis: 1 };
    const state = classify(26, raised.threshold);
    expect(state).toEqual({ side: "below" });

    // The next readings are judged against the new threshold.
    expect(run([26.5, 28.4, 28.6], raised, state).events).toEqual([
      null,
      null,
      "up",
    ]);
  });
});
