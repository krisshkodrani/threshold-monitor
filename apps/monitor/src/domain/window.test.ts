import { describe, expect, test } from "vitest";
import { RingBuffer } from "./window";

function filled(capacity: number, count: number): RingBuffer<number> {
  const buffer = new RingBuffer<number>(capacity);
  for (let i = 1; i <= count; i++) buffer.push(i);
  return buffer;
}

describe("RingBuffer", () => {
  test("starts empty", () => {
    const buffer = new RingBuffer<number>(3);
    expect(buffer.size).toBe(0);
    expect(buffer.toArray()).toEqual([]);
  });

  test("keeps items oldest to newest while not full", () => {
    expect(filled(5, 3).toArray()).toEqual([1, 2, 3]);
  });

  test("overwrites the oldest items once full", () => {
    expect(filled(3, 5).toArray()).toEqual([3, 4, 5]);
    expect(filled(3, 6).toArray()).toEqual([4, 5, 6]);
  });

  test("size never exceeds capacity", () => {
    const buffer = filled(120, 10_000);
    expect(buffer.size).toBe(120);
    expect(buffer.toArray().at(-1)).toBe(10_000);
    expect(buffer.toArray()[0]).toBe(10_000 - 119);
  });

  test("toArray returns the same instance until the next push", () => {
    const buffer = filled(3, 5);
    const first = buffer.toArray();
    expect(buffer.toArray()).toBe(first);

    buffer.push(6);
    const second = buffer.toArray();
    expect(second).not.toBe(first);
    expect(first).toEqual([3, 4, 5]); // old snapshots are never mutated
    expect(second).toEqual([4, 5, 6]);
  });

  test.each([0, -1, 2.5, NaN])("rejects capacity %s", (capacity) => {
    expect(() => new RingBuffer(capacity)).toThrow(RangeError);
  });
});
