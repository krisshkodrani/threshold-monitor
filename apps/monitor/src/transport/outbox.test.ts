import { describe, expect, test } from "vitest";
import {
  accept,
  createOutbox,
  enqueue,
  expire,
  nextDeadline,
  requeueAll,
  takeForSend,
  type Outbox,
} from "./outbox";

type Item = { id: string };

function withItems(ids: string[], capacity?: number): Outbox<Item> {
  let state = createOutbox<Item>(capacity);
  for (const id of ids) state = enqueue(state, { id }).state;
  return state;
}

const queued = (state: Outbox<Item>) => state.queue.map((e) => e.item.id);
const pending = (state: Outbox<Item>) => state.pending.map((e) => e.item.id);

describe("outbox", () => {
  test("sends in creation order and moves items to pending with a deadline", () => {
    const { state, toSend } = takeForSend(
      withItems(["a", "b", "c"]),
      1000,
      5000,
    );
    expect(toSend.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(queued(state)).toEqual([]);
    expect(pending(state)).toEqual(["a", "b", "c"]);
    expect(state.pending.every((e) => e.deadline === 6000)).toBe(true);
  });

  test("when full, drops the oldest queued item and reports it", () => {
    let state = withItems(["a", "b", "c"], 3);
    const result = enqueue(state, { id: "d" });
    state = result.state;
    expect(result.dropped).toEqual([{ id: "a" }]);
    expect(queued(state)).toEqual(["b", "c", "d"]);
  });

  test("pending items do not count against the queue capacity", () => {
    let state = takeForSend(withItems(["a", "b"], 2), 0).state;
    const result = enqueue(enqueue(state, { id: "c" }).state, { id: "d" });
    state = result.state;
    expect(result.dropped).toEqual([]);
    expect(pending(state)).toEqual(["a", "b"]);
    expect(queued(state)).toEqual(["c", "d"]);
  });

  test("accept removes an item from pending", () => {
    const state = accept(takeForSend(withItems(["a", "b"]), 0).state, "a");
    expect(pending(state)).toEqual(["b"]);
  });

  test("accept also removes an item that is still queued (e.g. reconciled after reconnect)", () => {
    expect(queued(accept(withItems(["a", "b"]), "b"))).toEqual(["a"]);
  });

  test("accept of an unknown id changes nothing", () => {
    const state = withItems(["a"]);
    expect(accept(state, "zzz")).toEqual(state);
  });

  test("expired items go back to the queue, ahead of newer items", () => {
    let state = takeForSend(withItems(["a", "b"]), 0, 5000).state; // deadline 5000
    state = enqueue(state, { id: "c" }).state; // created while a and b wait

    const early = expire(state, 4999);
    expect(early.expired).toEqual([]);

    const result = expire(state, 5000);
    expect(result.expired.map((i) => i.id)).toEqual(["a", "b"]);
    expect(pending(result.state)).toEqual([]);
    expect(queued(result.state)).toEqual(["a", "b", "c"]);
  });

  test("a resend after expiry carries the same id (the server deduplicates)", () => {
    let state = takeForSend(withItems(["a"]), 0, 5000).state;
    state = expire(state, 5000).state;
    expect(takeForSend(state, 5000).toSend).toEqual([{ id: "a" }]);
  });

  test("only items past their own deadline expire", () => {
    let state = takeForSend(withItems(["a"]), 0, 5000).state; // deadline 5000
    state = takeForSend(enqueue(state, { id: "b" }).state, 3000, 5000).state; // deadline 8000
    const result = expire(state, 6000);
    expect(queued(result.state)).toEqual(["a"]);
    expect(pending(result.state)).toEqual(["b"]);
  });

  test("requeueAll returns everything pending to the queue in creation order", () => {
    let state = takeForSend(withItems(["a", "b"]), 0).state;
    state = enqueue(state, { id: "c" }).state;
    state = requeueAll(state).state;
    expect(pending(state)).toEqual([]);
    expect(queued(state)).toEqual(["a", "b", "c"]);
  });

  test("requeueing beyond capacity drops the oldest", () => {
    let state = takeForSend(withItems(["a", "b"], 2), 0).state;
    state = enqueue(enqueue(state, { id: "c" }).state, { id: "d" }).state;
    const result = requeueAll(state);
    expect(result.dropped.map((i) => i.id)).toEqual(["a", "b"]);
    expect(queued(result.state)).toEqual(["c", "d"]);
  });

  test("nextDeadline is the earliest pending deadline, or null", () => {
    expect(nextDeadline(withItems(["a"]))).toBeNull();
    let state = takeForSend(withItems(["a"]), 1000, 5000).state;
    state = takeForSend(enqueue(state, { id: "b" }).state, 2000, 5000).state;
    expect(nextDeadline(state)).toBe(6000);
  });

  test("functions never mutate the state they are given", () => {
    const state = withItems(["a", "b"]);
    const before = structuredClone(state);
    takeForSend(state, 0);
    enqueue(state, { id: "c" });
    accept(state, "a");
    requeueAll(state);
    expect(state).toEqual(before);
  });
});
