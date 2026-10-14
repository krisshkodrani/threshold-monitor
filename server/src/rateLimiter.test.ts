import { describe, expect, test } from "vitest";
import { createBucket, take, type Bucket } from "./rateLimiter";

const cfg = { capacity: 3, refillPerSecond: 2 };

/** Takes `count` tokens at the same instant and returns which were allowed. */
function burst(bucket: Bucket, now: number, count: number) {
  const allowed: boolean[] = [];
  for (let i = 0; i < count; i++) {
    const result = take(bucket, now, cfg);
    bucket = result.bucket;
    allowed.push(result.allowed);
  }
  return { bucket, allowed };
}

describe("token bucket", () => {
  test("allows a burst up to capacity, then refuses", () => {
    expect(burst(createBucket(0, cfg), 0, 4).allowed).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  test("refills over time at the configured rate", () => {
    const empty = burst(createBucket(0, cfg), 0, 3).bucket;
    expect(take(empty, 499, cfg).allowed).toBe(false); // 0.998 tokens
    expect(burst(empty, 1000, 3).allowed).toEqual([true, true, false]); // 2 tokens after 1 s
  });

  test("never refills beyond capacity", () => {
    const empty = burst(createBucket(0, cfg), 0, 3).bucket;
    expect(burst(empty, 60_000, 4).allowed).toEqual([true, true, true, false]);
  });

  test("a clock going backwards does not add or remove tokens", () => {
    const bucket = createBucket(1000, cfg);
    expect(take(bucket, 0, cfg).bucket.tokens).toBe(2);
  });
});
