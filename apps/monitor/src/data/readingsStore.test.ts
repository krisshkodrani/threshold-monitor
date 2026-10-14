import { expect, test, vi } from "vitest";
import { createReadingsStore } from "./readingsStore";

test("notifies subscribers on push and exposes the latest reading", () => {
  const store = createReadingsStore(3);
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);

  store.push({ t: 1, value: 20 });
  store.push({ t: 2, value: 21 });
  expect(listener).toHaveBeenCalledTimes(2);
  expect(store.latest()).toEqual({ t: 2, value: 21 });

  unsubscribe();
  store.push({ t: 3, value: 22 });
  expect(listener).toHaveBeenCalledTimes(2);
});

test("the snapshot is stable between pushes and bounded by the window", () => {
  const store = createReadingsStore(120);
  const before = store.getSnapshot();
  expect(store.getSnapshot()).toBe(before);

  for (let i = 0; i < 10_000; i++) store.push({ t: i, value: i });
  expect(store.getSnapshot()).not.toBe(before);
  expect(store.getSnapshot()).toHaveLength(120);
});
