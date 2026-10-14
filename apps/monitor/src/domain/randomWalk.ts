import { mulberry32 } from "./rng";

export type RandomWalkOptions = {
  seed: number;
  /** Long-run average the value drifts around. */
  mean?: number;
  /** First value; defaults to `mean`. */
  start?: number;
  /** Fraction of the gap to the target closed per step (0..1). Higher = calmer. */
  reversion?: number;
  /** Standard deviation of the per-step random noise. */
  noise?: number;
  /** Two slow sine waves move the target, so the value wanders across the threshold. */
  slowAmplitude?: number;
  slowPeriod?: number; // in steps
  fastAmplitude?: number;
  fastPeriod?: number; // in steps
};

/**
 * Plausible sensor-like data: a mean-reverting random walk (discrete
 * Ornstein-Uhlenbeck process) pulled towards a slowly drifting target.
 * It is driven by the step count, not wall-clock time, so it stays pure and
 * deterministic for a given seed; changing the reading rate only plays it faster.
 */
export function createRandomWalk(options: RandomWalkOptions): () => number {
  const {
    seed,
    mean = 24,
    reversion = 0.08,
    noise = 0.35,
    slowAmplitude = 2.5,
    slowPeriod = 240,
    fastAmplitude = 0.8,
    fastPeriod = 37,
  } = options;
  const random = mulberry32(seed);
  let value = options.start ?? mean;
  let stepCount = 0;

  // Box-Muller transform: two uniform samples -> one standard normal sample.
  // `1 - random()` is in (0, 1], so the log never sees 0.
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

  return () => {
    const target =
      mean +
      slowAmplitude * Math.sin((2 * Math.PI * stepCount) / slowPeriod) +
      fastAmplitude * Math.sin((2 * Math.PI * stepCount) / fastPeriod);
    value += reversion * (target - value) + noise * gaussian();
    stepCount++;
    return Math.round(value * 100) / 100;
  };
}
