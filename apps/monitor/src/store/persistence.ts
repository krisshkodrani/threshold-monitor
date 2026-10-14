import { z } from "zod";
import { hysteresisRange, metric } from "../config";
import { initialThresholdState, type ThresholdState } from "./thresholdSlice";

export const SETTINGS_KEY = "threshold-monitor:settings:v1";

// Stored data is untrusted too: it may be from an older version, edited by
// hand, or corrupt. Anything that does not match exactly is ignored.
const settingsSchema = z.object({
  threshold: z.number().min(metric.min).max(metric.max),
  hysteresis: z.number().min(hysteresisRange.min).max(hysteresisRange.max),
});

/**
 * Storage is passed as a getter because even reading `window.localStorage`
 * can throw (e.g. blocked cookies), and that must not break the app.
 */
export function loadSettings(getStorage: () => Storage): ThresholdState {
  try {
    const raw = getStorage().getItem(SETTINGS_KEY);
    if (raw === null) return initialThresholdState;
    const parsed = settingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : initialThresholdState;
  } catch {
    return initialThresholdState;
  }
}

export function saveSettings(
  getStorage: () => Storage,
  settings: ThresholdState,
): void {
  try {
    getStorage().setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Quota exceeded or storage blocked: the app keeps working, it just won't remember.
  }
}

type StoreLike = {
  getState(): { threshold: ThresholdState };
  subscribe(listener: () => void): () => void;
};

/** Saves the threshold settings whenever they change. Returns the unsubscribe function. */
export function persistSettings(
  store: StoreLike,
  getStorage: () => Storage,
): () => void {
  let previous = store.getState().threshold;
  return store.subscribe(() => {
    const current = store.getState().threshold;
    // Redux keeps the slice reference when nothing in it changed, so this
    // skips the many actions (alerts, status) that don't touch settings.
    if (current === previous) return;
    previous = current;
    saveSettings(getStorage, current);
  });
}
