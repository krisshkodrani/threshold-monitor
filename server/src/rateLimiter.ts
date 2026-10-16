export type BucketConfig = {
  /** Burst size: how many messages may arrive at once. */
  capacity: number;
  /** Sustained rate: tokens added per second. */
  refillPerSecond: number;
};

export type Bucket = { tokens: number; updatedAt: number };

/**
 * The bucket of the browsers. Capacity 60 instead of the spec's 20, so a
 * fast burst of acks or settings changes is not refused. The sensor sends
 * readings and its outbox of up to 50 alerts, so it has its own, larger
 * bucket (SENSOR_BUCKET in relay.ts).
 */
export const DEFAULT_BUCKET: BucketConfig = {
  capacity: 60,
  refillPerSecond: 10,
};

export function createBucket(now: number, cfg: BucketConfig): Bucket {
  return { tokens: cfg.capacity, updatedAt: now };
}

/**
 * Token bucket as a pure function of (state, now): refill for the time that
 * passed, then try to spend one token. No timers, so tests pass `now` directly.
 */
export function take(
  bucket: Bucket,
  now: number,
  cfg: BucketConfig,
): { bucket: Bucket; allowed: boolean } {
  // A clock that steps backwards neither adds nor removes tokens.
  const updatedAt = Math.max(now, bucket.updatedAt);
  const elapsedSeconds = (updatedAt - bucket.updatedAt) / 1000;
  const tokens = Math.min(
    cfg.capacity,
    bucket.tokens + elapsedSeconds * cfg.refillPerSecond,
  );
  if (tokens < 1) return { bucket: { tokens, updatedAt }, allowed: false };
  return { bucket: { tokens: tokens - 1, updatedAt }, allowed: true };
}
