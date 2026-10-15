import type { Direction } from "@app/protocol";

export type { Direction };

/** One sample from the data source. `t` is epoch milliseconds. */
export type Reading = { t: number; value: number };

export type Side = "above" | "below";

/** `null` means "no reading seen yet", so there is no previous side to cross from. */
export type DetectorState = { side: Side | null };

export type DetectorConfig = { threshold: number; hysteresis: number };

export type CrossingEvent = { direction: Direction };
