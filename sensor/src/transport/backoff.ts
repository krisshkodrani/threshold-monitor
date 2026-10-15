export const BASE_DELAY_MS = 500;
export const MAX_DELAY_MS = 30_000;

/**
 * Reconnect delay for the given attempt (0 = first retry): exponential growth,
 * capped, with "equal jitter". The delay is randomly between half and all of the
 * capped value, so many clients that lost the server at the same moment do not
 * all retry at the same moment, while none retries sooner than half the base.
 *
 * `random` is injected instead of calling `Math.random`, so tests are exact.
 */
export function backoffDelay(attempt: number, random: () => number): number {
  // 2^6 * 500 already exceeds the cap; clamping the exponent avoids huge numbers.
  const exponent = Math.min(Math.max(attempt, 0), 16);
  const capped = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** exponent);
  return capped * (0.5 + random() * 0.5);
}
