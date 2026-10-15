import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

/** What a user may open: "operator" for the control room, "monitor" for the monitor. */
export const userRoleSchema = z.enum(["operator", "monitor"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export type User = {
  id: number;
  username: string;
  displayName: string;
  roles: UserRole[];
};

export const newUserSchema = z.object({
  username: z
    .string()
    .regex(/^[a-z0-9._-]{1,40}$/, "1 to 40 of a-z, 0-9, '.', '_' or '-'"),
  // The display name is the operator name in acknowledgements, which the protocol limits to 40.
  displayName: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(200),
  roles: z.array(userRoleSchema).min(1),
});
export type NewUser = z.infer<typeof newUserSchema>;

// scrypt cost: N = 2^15 needs 32 MiB, so maxmem is raised above the 32 MiB default.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;

function scrypt(password: string, salt: Buffer, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password, salt, KEY_LENGTH, options, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** Format: scrypt$N$r$p$salt$hash (base64url), so the cost can change later per hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await scrypt(password, Buffer.from(salt, "base64url"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

type UserRow = {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  roles: string;
};

export type UserStore = ReturnType<typeof createUserStore>;

export function createUserStore(
  db: DatabaseSync,
  clock: () => number = Date.now,
) {
  const insert = db.prepare(
    "INSERT INTO users (username, display_name, password_hash, roles, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const byName = db.prepare("SELECT * FROM users WHERE username = ?");
  const byId = db.prepare("SELECT * FROM users WHERE id = ?");
  // Verified when the username is unknown, so a wrong username takes as long
  // as a wrong password and the response time does not reveal which exists.
  const dummyHash = hashPassword(randomBytes(16).toString("hex"));

  return {
    /** Throws if the input is invalid or the username exists. */
    async add(input: NewUser): Promise<User> {
      const user = newUserSchema.parse(input);
      const hash = await hashPassword(user.password);
      const { lastInsertRowid } = insert.run(
        user.username,
        user.displayName,
        hash,
        [...new Set(user.roles)].join(","),
        new Date(clock()).toISOString(),
      );
      return this.get(Number(lastInsertRowid))!;
    },

    get(id: number): User | undefined {
      const row = byId.get(id) as UserRow | undefined;
      return row && toUser(row);
    },

    exists: (username: string) => byName.get(username) !== undefined,

    /** The user, if the username exists and the password is correct. */
    async verify(username: string, password: string): Promise<User | null> {
      const row = byName.get(username) as UserRow | undefined;
      const ok = await verifyPassword(
        password,
        row?.password_hash ?? (await dummyHash),
      );
      return row && ok ? toUser(row) : null;
    },
  };
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    roles: row.roles
      .split(",")
      .filter(
        (role): role is UserRole => userRoleSchema.safeParse(role).success,
      ),
  };
}

export const DEMO_USERS: NewUser[] = [
  {
    username: "operator",
    displayName: "Demo Operator",
    password: "demo",
    roles: ["operator"],
  },
  {
    username: "monitor",
    displayName: "Demo Monitor",
    password: "demo",
    roles: ["monitor"],
  },
];

/** Adds the demo users that do not exist yet. Returns the names it added. */
export async function addDemoUsers(users: UserStore): Promise<string[]> {
  const added: string[] = [];
  for (const user of DEMO_USERS) {
    if (users.exists(user.username)) continue;
    await users.add(user);
    added.push(user.username);
  }
  return added;
}
