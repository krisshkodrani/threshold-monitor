const KEY = "threshold-control:operator:v1";

/** The protocol allows 1 to 40 characters for an operator name. */
export const MAX_OPERATOR_LENGTH = 40;

export function normalizeOperator(value: string): string | null {
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_OPERATOR_LENGTH ? name : null;
}

/**
 * Storage is passed as a getter because even reading `window.localStorage`
 * can throw (blocked site data). Stored text is untrusted, so it is checked
 * like typed input; anything invalid counts as "no operator".
 */
export function loadOperator(getStorage: () => Storage): string | null {
  try {
    return normalizeOperator(getStorage().getItem(KEY) ?? "");
  } catch {
    return null;
  }
}

export function saveOperator(getStorage: () => Storage, name: string): void {
  try {
    getStorage().setItem(KEY, name);
  } catch {
    // Not remembered; the name still works until the page reloads.
  }
}
