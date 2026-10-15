import type { AlertRecord } from "@app/protocol";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createMemoryAlertStore,
  createSqliteAlertStore,
  type AlertStore,
} from "./alertStore";
import { openDatabase } from "./db";

function record(
  id: string,
  receivedAt = "2026-10-14T09:30:00.050Z",
): AlertRecord {
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
    receivedAt,
    acknowledgement: null,
  };
}

/** Different receipt times that go up, so "newest first" is clear. */
const at = (i: number) => `2026-10-14T09:30:${String(i).padStart(2, "0")}.000Z`;

// Both stores must behave the same for everything the routing code uses.
describe.each<[string, () => AlertStore]>([
  ["memory", () => createMemoryAlertStore(10)],
  ["sqlite", () => createSqliteAlertStore(openDatabase(":memory:"))],
])("%s alert store", (_name, createStore) => {
  test("stores and finds records by id", () => {
    const store = createStore();
    store.add(record("a"));
    expect(store.has("a")).toBe(true);
    expect(store.get("a")).toEqual(record("a"));
    expect(store.has("b")).toBe(false);
    expect(store.get("b")).toBeUndefined();
  });

  test("adding an existing id keeps the original", () => {
    const store = createStore();
    store.add(record("a"));
    store.add({ ...record("a"), value: 99 });
    expect(store.get("a")?.value).toBe(25.4);
    expect(store.recent(10)).toHaveLength(1);
  });

  test("recent returns newest first, up to the limit asked for", () => {
    const store = createStore();
    ["a", "b", "c", "d"].forEach((id, i) => store.add(record(id, at(i))));
    expect(store.recent(2).map((r) => r.id)).toEqual(["d", "c"]);
  });

  test("the first acknowledgement wins", () => {
    const store = createStore();
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
    const store = createStore();
    store.add(record("a"));
    const before = store.get("a");
    store.acknowledge("a", "Ana", "2026-10-14T09:31:00.000Z");
    expect(before?.acknowledgement).toBeNull();
  });

  test("acknowledging an unknown id returns undefined", () => {
    expect(createStore().acknowledge("zzz", "Ana", "x")).toBeUndefined();
  });
});

describe("memory alert store", () => {
  test("evicts the oldest beyond the limit, from the index too", () => {
    const store = createMemoryAlertStore(2);
    ["a", "b", "c"].forEach((id) => store.add(record(id)));
    expect(store.has("a")).toBe(false);
    expect(store.get("a")).toBeUndefined();
    expect(store.recent(10).map((r) => r.id)).toEqual(["c", "b"]);
  });
});

describe("sqlite alert store", () => {
  test("alerts and acknowledgements survive closing and opening the file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "alerts-"));
    const file = path.join(dir, "test.db");
    try {
      const first = openDatabase(file);
      const store = createSqliteAlertStore(first);
      store.add(record("a", at(1)));
      store.add(record("b", at(2)));
      store.acknowledge("a", "Ana", "2026-10-14T09:31:00.000Z");
      first.close();

      const second = openDatabase(file);
      const reopened = createSqliteAlertStore(second);
      expect(reopened.recent(10).map((r) => r.id)).toEqual(["b", "a"]);
      expect(reopened.get("a")?.acknowledgement?.operator).toBe("Ana");
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("keeps every alert; only recent() is limited", () => {
    const store = createSqliteAlertStore(openDatabase(":memory:"));
    for (let i = 0; i < 20; i++) store.add(record(`id-${i}`, at(i)));
    expect(store.has("id-0")).toBe(true);
    expect(store.recent(3).map((r) => r.id)).toEqual([
      "id-19",
      "id-18",
      "id-17",
    ]);
  });

  test("records which user acknowledged, for the audit trail", () => {
    const db = openDatabase(":memory:");
    db.prepare(
      "INSERT INTO users (id, username, display_name, password_hash, roles, created_at) VALUES (7, 'ana', 'Ana', 'x', 'operator', 'now')",
    ).run();
    const store = createSqliteAlertStore(db);
    store.add(record("a"));
    store.acknowledge("a", "Ana", "2026-10-14T09:31:00.000Z", 7);
    expect(
      db.prepare("SELECT ack_user_id FROM alerts WHERE id = 'a'").get(),
    ).toEqual({ ack_user_id: 7 });
  });
});
