/** The signed-in user, from the relay's GET /api/session. */
export type Account = {
  username: string;
  displayName: string;
  roles: string[];
};

function isAccount(value: unknown): value is Account {
  if (!value || typeof value !== "object") return false;
  const { username, displayName, roles } = value as Record<string, unknown>;
  return (
    typeof username === "string" &&
    typeof displayName === "string" &&
    Array.isArray(roles) &&
    roles.every((role) => typeof role === "string")
  );
}

/**
 * The account of this browser's session, or null when it has none.
 * Other failures (relay down, bad answer) throw, so the page can say so.
 */
export async function fetchAccount(
  fetchFn: typeof fetch = fetch,
): Promise<Account | null> {
  const res = await fetchFn("/api/session", { cache: "no-store" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Session check failed (HTTP ${res.status}).`);
  const body: unknown = await res.json();
  if (!isAccount(body))
    throw new Error("Session check gave an invalid answer.");
  return body;
}

/** The relay's login page, which comes back to `next` (a path on this site). */
export const loginUrl = (next: string) =>
  `/login?next=${encodeURIComponent(next)}`;

/** Ends the session. The relay also closes this browser's sockets (4003). */
export async function logout(fetchFn: typeof fetch = fetch): Promise<void> {
  await fetchFn("/api/logout", { method: "POST" });
}
