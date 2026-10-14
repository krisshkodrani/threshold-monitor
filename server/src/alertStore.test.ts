import type { AlertRecord } from "@app/protocol";
import { describe, expect, test } from "vitest";
import { createMemoryAlertStore } from "./alertStore";

function record(id: string): AlertRecord {
  return {
    id,
    sourceId: "8b2e4d71-0c3f-4a59-b6e8-5d1a9f7c3b02",
    sourceLabel: "Monitor 8B2",
    metric: "temperature",
    unit: "°C",
    threshold: 25,
    hysteresis: 0.6,
    value: 25.4,
    direction: "up",
    eventTime: "2026-10-14T09:30:00.000Z",
    receivedAt: "2026-10-14T09:30:00.050Z",
    acknowledgement: null,
  };
}

describe("memory alert store", () => {
  test("stores and finds records by id", () => {
    const store = createMemoryAlertStore(10);
    store.add(record("a"));
    expect(store.has("a")).toBe(true);
    expect(store.get("a")?.id).toBe("a");
    expect(store.has("b")).toBe(false);
    expect(store.get("b")).toBeUndefined();
  });

  test("adding an existing id keeps the original", () => {
    const store = createMemoryAlertStore(10);
    store.add(record("a"));
    store.add({ ...record("a"), value: 99 });
    expect(store.get("a")?.value).toBe(25.4);
    expect(store.recent(10)).toHaveLength(1);
  });

  test("evicts the oldest beyond the limit, from the index too", () => {
    const store = createMemoryAlertStore(2);
    ["a", "b", "c"].forEach((id) => store.add(record(id)));
    expect(store.has("a")).toBe(false);
    expect(store.get("a")).toBeUndefined();
    expect(store.recent(10).map((r) => r.id)).toEqual(["c", "b"]);
  });

  test("recent returns newest first, up to the limit asked for", () => {
    const store = createMemoryAlertStore(10);
    ["a", "b", "c", "d"].forEach((id) => store.add(record(id)));
    expect(store.recent(2).map((r) => r.id)).toEqual(["d", "c"]);
  });

  test("the first acknowledgement wins", () => {
    const store = createMemoryAlertStore(10);
    store.add(record("a"));
    const first = store.acknowledge("a", "Ana", "2026-10-14T09:31:00.000Z");
    const second = store.acknowledge("a", "Ben", "2026-10-14T09:32:00.000Z");
    expect(first?.acknowledgement).toEqual({
      operator: "Ana",
      at: "2026-10-14T09:31:00.000Z",
    });
    expect(second?.acknowledgement?.operator).toBe("Ana");
    expect(store.get("a")?.acknowledgement?.operator).toBe("Ana");
  });

  test("acknowledging does not mutate records handed out earlier", () => {
    const store = createMemoryAlertStore(10);
    store.add(record("a"));
    const before = store.get("a");
    store.acknowledge("a", "Ana", "2026-10-14T09:31:00.000Z");
    expect(before?.acknowledgement).toBeNull();
  });

  test("acknowledging an unknown id returns undefined", () => {
    expect(
      createMemoryAlertStore(10).acknowledge("zzz", "Ana", "x"),
    ).toBeUndefined();
  });
});
