import { describe, expect, test } from "vitest";
import { blockedStorage, memoryStorage } from "../test/fakes";
import { createAppStore } from "./index";
import {
  loadSettings,
  persistSettings,
  SETTINGS_KEY,
  saveSettings,
} from "./persistence";
import { initialThresholdState, thresholdCommitted } from "./thresholdSlice";
import { statusChanged } from "./connectionSlice";

function storageWith(raw: string) {
  const storage = memoryStorage();
  storage.setItem(SETTINGS_KEY, raw);
  return () => storage;
}

describe("settings persistence", () => {
  test("round trip: what is saved is loaded", () => {
    const storage = memoryStorage();
    saveSettings(() => storage, { threshold: 22.5, hysteresis: 1.2 });
    expect(loadSettings(() => storage)).toEqual({
      threshold: 22.5,
      hysteresis: 1.2,
    });
  });

  test("nothing stored yet: defaults", () => {
    expect(loadSettings(memoryStorage)).toEqual(initialThresholdState);
  });

  test.each([
    ["corrupt JSON", "{threshold: 2"],
    ["wrong types", JSON.stringify({ threshold: "25", hysteresis: 0.6 })],
    ["missing field", JSON.stringify({ threshold: 25 })],
    [
      "threshold out of range",
      JSON.stringify({ threshold: 500, hysteresis: 0.6 }),
    ],
    ["negative hysteresis", JSON.stringify({ threshold: 25, hysteresis: -1 })],
    ["null", "null"],
  ])("%s: falls back to defaults", (_label, raw) => {
    expect(loadSettings(storageWith(raw))).toEqual(initialThresholdState);
  });

  test("storage that throws on read: defaults, no crash", () => {
    expect(loadSettings(blockedStorage)).toEqual(initialThresholdState);
  });

  test("storage that throws on write: no crash", () => {
    const full = memoryStorage();
    full.setItem = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
    expect(() => saveSettings(() => full, initialThresholdState)).not.toThrow();
  });

  test("persistSettings saves only when the threshold settings change", () => {
    const storage = memoryStorage();
    let writes = 0;
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      writes++;
      setItem(key, value);
    };
    const store = createAppStore();
    persistSettings(store, () => storage);

    store.dispatch(statusChanged({ kind: "open" }));
    expect(writes).toBe(0);

    store.dispatch(thresholdCommitted(23));
    expect(writes).toBe(1);
    expect(loadSettings(() => storage).threshold).toBe(23);
  });
});
