import { defaults, rateOptions } from "./config";

export type LaunchOptions = { seed: number; rateHz: number };

/**
 * Reads `?seed=123&rate=10` from the URL so demos and the e2e test get
 * reproducible, fast data. Accepted in every build: it only changes the
 * generated demo data, never what the app is allowed to do. Invalid values
 * fall back to the defaults.
 */
export function readLaunchOptions(search: string): LaunchOptions {
  const params = new URLSearchParams(search);
  const seed = params.get("seed") ?? "";
  const rate = Number(params.get("rate"));

  return {
    // Digits only: Number("") would silently be 0.
    seed: /^\d{1,9}$/.test(seed) ? Number(seed) : defaults.seed,
    rateHz: rateOptions.some((option) => option === rate)
      ? rate
      : defaults.rateHz,
  };
}
