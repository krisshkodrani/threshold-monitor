import { describe, expect, test } from "vitest";
import { openDatabase } from "./db";
import {
  createMemorySettingsStore,
  createSqliteSettingsStore,
  type SettingsStore,
} from "./settingsStore";

const A = "5d0a2f6e-1c3b-4e7a-9b8d-2f4e6a8c0b13";
const B = "6e1b3a7f-2d4c-4f8b-8c9e-3a5f7b9d1c24";
const at = (s: number) => `2026-10-14T09:30:0${s}.000Z`;

describe.each<[string, () => SettingsStore]>([
  ["memory", () => createMemorySettingsStore()],
  ["sqlite", () => createSqliteSettingsStore(openDatabase(":memory:"))],
])("%s settings store", (_name, createStore) => {
  test("is empty at first", () => {
    const store = createStore();
    expect(store.get(A)).toBeUndefined();
    expect(store.latest()).toBeUndefined();
  });

  test("stores, replaces and finds the latest settings", () => {
    const store = createStore();
    store.set(A, {
      threshold: 25,
      hysteresis: 0.6,
      updatedBy: null,
      at: at(1),
    });
    store.set(B, { threshold: 10, hysteresis: 0, updatedBy: "Ana", at: at(2) });
    store.set(A, {
      threshold: 22,
      hysteresis: 0.2,
      updatedBy: "Ben",
      at: at(3),
    });
    expect(store.get(A)).toEqual({
      threshold: 22,
      hysteresis: 0.2,
      updatedBy: "Ben",
      at: at(3),
    });
    expect(store.latest()).toEqual({ sensorId: A, settings: store.get(A) });
  });
});
