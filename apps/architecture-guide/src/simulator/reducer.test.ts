import { describe, expect, it } from "vitest";
import { newSimulation, simulationPresets } from "./model";
import { simulationFinished, simulationReducer } from "./reducer";
import { simulationMessageModel } from "./messages";
import { parseSession } from "./persistence";
import type { SimulationState } from "./types";

const advance = (state: SimulationState) =>
  simulationReducer(state, { type: "NEXT_STAGE" });
function initial(name = "crossings") {
  return {
    ...newSimulation(structuredClone(simulationPresets[name]!)),
    scenario: ["configure", "hysteresis"].includes(name) ? name : null,
  };
}
function complete(state: SimulationState) {
  for (let n = 0; n < 400 && !simulationFinished(state); n++)
    state = advance(state);
  expect(simulationFinished(state)).toBe(true);
  return state;
}
function saved(state: SimulationState) {
  return JSON.stringify({
    version: 1,
    simulation: state,
    inputs: { threshold: "25", hysteresis: "0.6", sequence: "24, 26" },
    speed: "1",
    view: "map",
  });
}

describe("simulation reducer", () => {
  it("keeps detector, relay acceptance, and browser delivery as separate immutable stages", () => {
    let state = initial("zero");
    for (let i = 0; i < 3; i++) state = advance(state);
    const previous = structuredClone(state);
    const sensor = advance(state);
    expect(state).toEqual(previous);
    expect(sensor.pending).toHaveLength(1);
    expect(sensor.relayAlerts).toHaveLength(0);
    expect(sensor.controlAlerts).toHaveLength(0);
    const relay = advance(sensor);
    expect(relay.pending).toHaveLength(0);
    expect(relay.relayAlerts).toHaveLength(1);
    expect(relay.controlAlerts).toHaveLength(0);
    const browser = advance(relay);
    expect(browser.monitorAlerts).toEqual(browser.relayAlerts);
    expect(browser.controlAlerts).toEqual(browser.relayAlerts);
    expect(browser.controlAlerts[0]).not.toBe(browser.relayAlerts[0]);
  });
  it.each([
    ["crossings", 2],
    ["noise", 0],
    ["zero", 3],
    ["edges", 2],
    ["initial", 1],
    ["configure", 1],
    ["hysteresis", 2],
  ])("completes %s with %i expected alerts", (name, count) => {
    let state = initial(String(name));
    for (let n = 0; n < 100 && !simulationFinished(state); n++) {
      expect(simulationMessageModel(state).rows.length).toBeGreaterThan(0);
      expect(parseSession(saved(state))?.simulation).toEqual(state);
      state = advance(state);
    }
    expect(simulationFinished(state)).toBe(true);
    expect(state.relayAlerts).toHaveLength(Number(count));
    expect(state.monitorReadings).toHaveLength(state.config.readings.length);
    expect(advance(state)).toBe(state);
  });
  it("applies configuration without generating an alarm and reclassifies on the next reading", () => {
    let state = initial("configure");
    for (let i = 0; i < 6; i++) state = advance(state);
    for (let i = 0; i < 3; i++) {
      state = advance(state);
      expect(state.alertCount).toBe(0);
    }
    expect(state.config.threshold).toBe(24);
    state = advance(state);
    expect(state.detector.side).toBe("above");
    expect(state.alertCount).toBe(0);
    expect(complete(state).relayAlerts[0]?.direction).toBe("down");
  });
  it("narrows the band without an alert, then uses the new edges for later readings", () => {
    let state = initial("hysteresis");
    for (let n = 0; n < 6; n++) state = advance(state);
    expect(state.alertCount).toBe(0);
    for (let n = 0; n < 2; n++) {
      state = advance(state);
      expect(state.config.hysteresis).toBe(0.6);
      expect(state.alertCount).toBe(0);
    }
    state = advance(state);
    expect(state.config).toMatchObject({ threshold: 25, hysteresis: 0.2 });
    expect(state.alertCount).toBe(0);
    state = advance(state);
    expect(state.detector.side).toBe("above");
    expect(state.alertCount).toBe(0);
    state = complete(state);
    expect(
      state.relayAlerts.map((alert) => [
        alert.value,
        alert.direction,
        alert.hysteresis,
      ]),
    ).toEqual([
      [24.85, "down", 0.2],
      [25.15, "up", 0.2],
    ]);
    let unchanged: SimulationState = {
      ...initial("hysteresis"),
      scenario: null,
    };
    unchanged = complete(unchanged);
    expect(unchanged.alertCount).toBe(0);
  });
  it("acknowledges only delivered alarms, stores first, then updates both browser copies", () => {
    const initialState = initial();
    expect(
      simulationReducer(initialState, { type: "REQUEST_ACK", id: "missing" }),
    ).toBe(initialState);
    let state = complete(initialState);
    const id = state.controlAlerts[0]!.id;
    state = simulationReducer(state, { type: "REQUEST_ACK", id });
    expect(state.ack?.phase).toBe(1);
    for (let stage = 1; stage <= 3; stage++) {
      expect(parseSession(saved(state))?.simulation).toEqual(state);
      expect(simulationMessageModel(state).isAck).toBe(true);
      state = advance(state);
      if (stage < 3) expect(state.controlAlerts[0]?.acknowledgement).toBeNull();
    }
    expect(state.ack).toBeNull();
    expect(state.controlAlerts[0]?.acknowledgement?.operator).toBe("Alex");
    expect(state.controlAlerts).toEqual(state.monitorAlerts);
    expect(simulationReducer(state, { type: "REQUEST_ACK", id })).toBe(state);
  });
  it("does not accept acknowledgement before browser delivery", () => {
    let state = initial("zero");
    for (let n = 0; n < 4; n++) state = advance(state);
    const id = state.pending[0]!.id;
    expect(simulationReducer(state, { type: "REQUEST_ACK", id })).toBe(state);
    state = advance(state);
    expect(simulationReducer(state, { type: "REQUEST_ACK", id })).toBe(state);
    state = advance(state);
    expect(simulationReducer(state, { type: "REQUEST_ACK", id }).ack?.id).toBe(
      id,
    );
  });
  it.each([0, 1, 2])(
    "preserves a partly delivered sample at phase %i throughout an acknowledgement",
    (phase) => {
      let state = initial("zero");
      for (let n = 0; n < 6 + phase; n++) state = advance(state);
      const id = state.controlAlerts[0]!.id;
      const progress = (s: SimulationState) => ({
        index: s.index,
        phase: s.phase,
        current: s.current,
        detector: s.detector,
        pending: s.pending,
        relayReadings: s.relayReadings,
        monitorReadings: s.monitorReadings,
        alertCount: s.alertCount,
      });
      const before = structuredClone(progress(state));
      state = simulationReducer(state, { type: "REQUEST_ACK", id });
      expect(simulationReducer(state, { type: "REQUEST_ACK", id })).toBe(state);
      for (let stage = 0; stage < 3; stage++) {
        expect(progress(state)).toEqual(before);
        state = advance(state);
      }
      expect(progress(state)).toEqual(before);
      expect(state.ack).toBeNull();
      const finished = complete(state);
      expect(finished.monitorReadings.map((r) => r.value)).toEqual(
        simulationPresets.zero!.readings,
      );
      expect(finished.controlAlerts).toHaveLength(3);
      expect(new Set(finished.controlAlerts.map((a) => a.id)).size).toBe(3);
      expect(
        finished.controlAlerts.find((a) => a.id === id)?.acknowledgement,
      ).toEqual(finished.relayAlerts.find((a) => a.id === id)?.acknowledgement);
    },
  );
  it.each([1, 2, 3])(
    "restores acknowledgement phase %i and completes exactly the remaining stages",
    (phase) => {
      let state = complete(initial("zero"));
      state = simulationReducer(state, {
        type: "REQUEST_ACK",
        id: state.controlAlerts[0]!.id,
      });
      for (let n = 1; n < phase; n++) state = advance(state);
      const restored = parseSession(saved(state))!.simulation;
      expect(restored).toEqual(state);
      expect(complete(restored)).toEqual(complete(state));
    },
  );
  it("projects request, storage, broadcast and browser application into distinct routes", () => {
    let state = complete(initial("zero"));
    state = simulationReducer(state, {
      type: "REQUEST_ACK",
      id: state.controlAlerts[0]!.id,
    });
    const edges = (s: SimulationState) =>
      simulationMessageModel(s)
        .rows.filter((row) => row.state === "active" && row.edge)
        .map((row) => row.edge);
    expect(edges(state)).toEqual(["control-relay"]);
    state = advance(state);
    expect(edges(state)).toEqual(["relay-database"]);
    expect(state.relayAlerts[0]?.acknowledgement?.operator).toBe("Alex");
    expect(state.controlAlerts[0]?.acknowledgement).toBeNull();
    state = advance(state);
    expect(edges(state)).toEqual([
      "relay-sensor",
      "relay-monitor",
      "relay-control",
    ]);
    expect(state.controlAlerts[0]?.acknowledgement).toBeNull();
    state = advance(state);
    const model = simulationMessageModel(state);
    expect(model.stage).toBe(4);
    expect(edges(state)).toEqual([]);
    expect(
      model.rows.filter((row) => row.state === "active").map((row) => row.id),
    ).toEqual(["ack-apply-monitor", "ack-apply-control"]);
    expect(
      model.rows
        .filter((row) => row.edge)
        .every((row) => row.state === "complete"),
    ).toBe(true);
  });
  it("restarts cleanly during an acknowledgement", () => {
    let state = complete(initial());
    state = simulationReducer(state, {
      type: "REQUEST_ACK",
      id: state.controlAlerts[0]!.id,
    });
    state = advance(state);
    state = simulationReducer(state, {
      type: "RESTART",
      config: structuredClone(simulationPresets.crossings!),
    });
    expect(state).toEqual(initial());
    expect(advance(state).ack).toBeNull();
  });
  it("accepts older snapshots while discarding automatic playback intent", () => {
    let state = complete(initial());
    state = simulationReducer(state, {
      type: "REQUEST_ACK",
      id: state.controlAlerts[0]!.id,
    });
    const legacy = JSON.parse(saved(state)) as {
      simulation: { ack: Record<string, unknown> };
      speed: string;
    };
    legacy.simulation.ack.resumePlayback = true;
    expect(parseSession(JSON.stringify(legacy))?.simulation).toEqual(state);
    const malformed = structuredClone(legacy);
    malformed.simulation.ack.phase = "1";
    expect(parseSession(JSON.stringify(malformed))).toBeNull();
  });
  it("rejects malformed persisted records and incompatible versions", () => {
    expect(parseSession("invalid")).toBeNull();
    expect(parseSession('{"version":99}')).toBeNull();
    const state = complete(initial());
    const broken = JSON.parse(saved(state)) as {
      simulation: { relayAlerts: unknown[] };
    };
    broken.simulation.relayAlerts = [null];
    expect(parseSession(JSON.stringify(broken))).toBeNull();
    const brokenAck = {
      ...state,
      ack: { id: "missing", phase: 2, record: null },
    };
    expect(parseSession(saved(brokenAck))).toBeNull();
  });
});
