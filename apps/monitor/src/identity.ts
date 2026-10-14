export type SourceIdentity = { sourceId: string; sourceLabel: string };

const KEY = "threshold-monitor:identity:v1";

/**
 * Who this monitor is, so a control room can tell two monitor tabs apart.
 * Kept in sessionStorage: stable across reloads of the same tab, different
 * per tab. If storage is unavailable we still work, just with a new identity.
 */
export function getSourceIdentity(
  getStorage: () => Storage,
  newId: () => string = () => crypto.randomUUID(),
): SourceIdentity {
  try {
    const stored = getStorage().getItem(KEY);
    if (stored !== null) {
      const parsed = JSON.parse(stored) as Partial<SourceIdentity>;
      if (
        typeof parsed.sourceId === "string" &&
        typeof parsed.sourceLabel === "string"
      ) {
        return { sourceId: parsed.sourceId, sourceLabel: parsed.sourceLabel };
      }
    }
  } catch {
    // Unreadable or corrupt: fall through and create a new identity.
  }

  const sourceId = newId();
  const identity = {
    sourceId,
    sourceLabel: `Monitor ${sourceId.slice(0, 3).toUpperCase()}`,
  };
  try {
    getStorage().setItem(KEY, JSON.stringify(identity));
  } catch {
    // Not persisted; the identity is still valid for this page load.
  }
  return identity;
}
