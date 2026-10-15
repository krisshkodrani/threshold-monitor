import fc from "fast-check";
import { expect, test } from "vitest";
import { step } from "./crossing";
import type { DetectorConfig, Direction } from "./types";

type Emitted = { direction: Direction; value: number };

function detect(values: number[], cfg: DetectorConfig): Emitted[] {
  let state = { side: null } as Parameters<typeof step>[0];
  const events: Emitted[] = [];
  for (const value of values) {
    const [next, event] = step(state, value, cfg);
    state = next;
    if (event) events.push({ direction: event.direction, value });
  }
  return events;
}

// A config plus a sequence of readings. Some readings are snapped exactly onto
// T, T + h/2 or T - h/2, because that is where off-by-one bugs live.
const scenario = fc
  .record({
    threshold: fc.double({ min: -50, max: 50, noNaN: true }),
    hysteresis: fc.double({ min: 0, max: 20, noNaN: true }),
  })
  .chain((cfg) => {
    const edges = [
      cfg.threshold,
      cfg.threshold + cfg.hysteresis / 2,
      cfg.threshold - cfg.hysteresis / 2,
    ];
    const value = fc.oneof(
      { arbitrary: fc.double({ min: -100, max: 100, noNaN: true }), weight: 4 },
      { arbitrary: fc.constantFrom(...edges), weight: 1 },
    );
    return fc.record({
      cfg: fc.constant(cfg),
      values: fc.array(value, { maxLength: 200 }),
    });
  });

const runs = { numRuns: 500 };

test("events strictly alternate direction", () => {
  fc.assert(
    fc.property(scenario, ({ cfg, values }) => {
      const events = detect(values, cfg);
      for (let i = 1; i < events.length; i++) {
        expect(events[i]?.direction).not.toBe(events[i - 1]?.direction);
      }
    }),
    runs,
  );
});

test("the first event moves away from the side of the first reading", () => {
  fc.assert(
    fc.property(scenario, ({ cfg, values }) => {
      const [first] = detect(values, cfg);
      if (first === undefined || values[0] === undefined) return;
      expect(first.direction).toBe(values[0] > cfg.threshold ? "down" : "up");
    }),
    runs,
  );
});

test("every event value lies strictly outside the hysteresis band", () => {
  fc.assert(
    fc.property(scenario, ({ cfg, values }) => {
      for (const { direction, value } of detect(values, cfg)) {
        if (direction === "up")
          expect(value).toBeGreaterThan(cfg.threshold + cfg.hysteresis / 2);
        else expect(value).toBeLessThan(cfg.threshold - cfg.hysteresis / 2);
      }
    }),
    runs,
  );
});

// Why this holds: a hysteresis "up" event has value > T, so a plain detector is
// "above" there; the previous hysteresis event ("down", value < T) or the first
// reading (<= T) left it "below". So the plain detector also crossed up in that
// interval. Intervals between consecutive events do not overlap, so every
// hysteresis event maps to a different plain event (same argument for "down").
test("hysteresis never produces more events than a plain detector", () => {
  fc.assert(
    fc.property(scenario, ({ cfg, values }) => {
      const withBand = detect(values, cfg).length;
      const plain = detect(values, {
        threshold: cfg.threshold,
        hysteresis: 0,
      }).length;
      expect(withBand).toBeLessThanOrEqual(plain);
    }),
    runs,
  );
});

test("step is deterministic", () => {
  fc.assert(
    fc.property(scenario, ({ cfg, values }) => {
      expect(detect(values, cfg)).toEqual(detect(values, cfg));
    }),
    runs,
  );
});
