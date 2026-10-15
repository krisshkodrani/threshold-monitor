import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { UserRole } from "./users";

export const SESSION_COOKIE = "tm_session";

/** Who is on the other end of a request. `id` names the session, not the user. */
export type Session = {
  id: string;
  userId: number;
  username: string;
  displayName: string;
  roles: UserRole[];
};

/**
 * The cookie value is a random token; the database keeps only its SHA-256,
 * so a copy of the database cannot be used to log in. The hash is also the
 * session id that the relay uses to close the sockets of a session.
 */
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("base64url");

type SessionRow = {
  token_hash: string;
  user_id: number;
  expires_at: string;
  username: string;
  display_name: string;
  roles: string;
};

export type SessionStore = ReturnType<typeof createSessionStore>;

export function createSessionStore(
  db: DatabaseSync,
  { ttlMs, clock = Date.now }: { ttlMs: number; clock?: () => number },
) {
  const insert = db.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  );
  const find = db.prepare(
    `SELECT s.token_hash, s.user_id, s.expires_at, u.username, u.display_name, u.roles
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  );
  const remove = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
  const active = db.prepare(
    "SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?",
  );
  const removeExpired = db.prepare(
    "DELETE FROM sessions WHERE expires_at <= ?",
  );
  const iso = (ms: number) => new Date(ms).toISOString();

  return {
    ttlMs,

    /** Returns the token for the cookie. Old expired sessions are removed here too. */
    create(userId: number): string {
      const now = clock();
      removeExpired.run(iso(now));
      const token = randomBytes(32).toString("base64url");
      insert.run(hashToken(token), userId, iso(now), iso(now + ttlMs));
      return token;
    },

    find(token: string): Session | null {
      const row = find.get(hashToken(token)) as SessionRow | undefined;
      if (!row) return null;
      if (row.expires_at <= iso(clock())) {
        remove.run(row.token_hash);
        return null;
      }
      return {
        id: row.token_hash,
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name,
        roles: row.roles.split(",") as UserRole[],
      };
    },

    /** True while the session (by id) exists and is not expired. */
    isActive: (sessionId: string) =>
      active.get(sessionId, iso(clock())) !== undefined,

    /** Returns the session id of the removed session, if there was one. */
    remove(token: string): string {
      const id = hashToken(token);
      remove.run(id);
      return id;
    },
  };
}

/** The session token from a Cookie header, if present. */
export function readSessionToken(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=") || null;
  }
  return null;
}

/** Resolves the session of a request (HTTP or WebSocket upgrade). */
export function authenticate(
  req: IncomingMessage,
  sessions: SessionStore,
): Session | null {
  const token = readSessionToken(req);
  return token ? sessions.find(token) : null;
}

/**
 * HttpOnly: page scripts cannot read it. SameSite=Strict: other sites cannot
 * make the browser send it, which also blocks cross-site form posts (CSRF).
 */
export function sessionCookie(
  token: string,
  { maxAgeMs, secure }: { maxAgeMs: number; secure: boolean },
): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export const clearedSessionCookie = (secure: boolean) =>
  sessionCookie("", { maxAgeMs: 0, secure });
