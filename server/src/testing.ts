import { openDatabase } from "./db";
import type { AuthDeps } from "./http";
import { createSessionStore } from "./sessions";
import { createUserStore, type NewUser } from "./users";

/** For tests: an in-memory database with users, sessions and auth deps. */
export function createTestAuth({
  origin = "http://test.local",
  clock = Date.now,
  ttlMs = 60 * 60 * 1000,
}: { origin?: string; clock?: () => number; ttlMs?: number } = {}) {
  const db = openDatabase(":memory:");
  const users = createUserStore(db, clock);
  const sessions = createSessionStore(db, { ttlMs, clock });
  const auth: AuthDeps = {
    users,
    sessions,
    config: { mode: "test", allowedOrigins: [origin], cookieSecure: false },
    clock,
  };

  /** Adds a user and returns the Cookie header of a fresh session for it. */
  async function signIn(user: Partial<NewUser> & { username: string }) {
    const added = await users.add({
      displayName: user.username,
      password: "password",
      roles: ["operator", "monitor"],
      ...user,
    });
    return { user: added, cookie: `tm_session=${sessions.create(added.id)}` };
  }

  return { db, users, sessions, auth, signIn };
}
