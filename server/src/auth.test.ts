import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createHttpServer, safeNext, type AuthDeps } from "./http";
import { silentLogger } from "./logger";
import { escapeHtml } from "./loginPage";
import { sessionCookie } from "./sessions";
import { createTestAuth } from "./testing";
import { addDemoUsers, hashPassword, verifyPassword } from "./users";

const ORIGIN = "http://test.local";

describe("passwords", () => {
  test("a hash verifies its own password only", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("correct horsE", hash)).toBe(false);
  });

  test("the same password gets a different salt each time", async () => {
    expect(await hashPassword("x")).not.toBe(await hashPassword("x"));
  });

  test.each(["", "md5$abc", "scrypt$1$2$3$salt"])(
    "a malformed hash %j never verifies",
    async (stored) => {
      expect(await verifyPassword("x", stored)).toBe(false);
    },
  );
});

describe("user store", () => {
  test("verify returns the user for the right password, else null", async () => {
    const { users } = createTestAuth();
    await users.add({
      username: "ana",
      displayName: "Ana",
      password: "secret-1",
      roles: ["operator", "operator"],
    });
    expect(await users.verify("ana", "secret-1")).toMatchObject({
      username: "ana",
      displayName: "Ana",
      roles: ["operator"],
    });
    expect(await users.verify("ana", "wrong")).toBeNull();
    expect(await users.verify("nobody", "secret-1")).toBeNull();
  });

  test("rejects a duplicate username and invalid input", async () => {
    const { users } = createTestAuth();
    const ana = {
      username: "ana",
      displayName: "Ana",
      password: "x",
      roles: ["operator" as const],
    };
    await users.add(ana);
    await expect(users.add(ana)).rejects.toThrow(/UNIQUE/);
    await expect(
      users.add({ ...ana, username: "Ana Smith" }),
    ).rejects.toThrow();
    await expect(
      users.add({ ...ana, username: "b", roles: [] }),
    ).rejects.toThrow();
    await expect(
      users.add({ ...ana, username: "c", displayName: "x".repeat(41) }),
    ).rejects.toThrow();
  });

  test("demo users are added once", async () => {
    const { users } = createTestAuth();
    expect(await addDemoUsers(users)).toEqual(["operator", "monitor", "demo"]);
    expect(await addDemoUsers(users)).toEqual([]);
    expect(await users.verify("monitor", "demo")).toMatchObject({
      roles: ["monitor"],
    });
  });
});

describe("session store", () => {
  test("finds a session by its token, with the user's details", async () => {
    const { sessions, signIn } = createTestAuth();
    const { user, cookie } = await signIn({
      username: "ana",
      displayName: "Ana",
      roles: ["operator"],
    });
    const token = cookie.split("=")[1]!;
    expect(sessions.find(token)).toMatchObject({
      userId: user.id,
      username: "ana",
      displayName: "Ana",
      roles: ["operator"],
    });
    expect(sessions.find("not-a-token")).toBeNull();
  });

  test("isActive follows expiry and logout", async () => {
    let now = 1_000_000;
    const { sessions, signIn } = createTestAuth({
      clock: () => now,
      ttlMs: 1000,
    });
    const first = (await signIn({ username: "ana" })).cookie.split("=")[1]!;
    const second = sessions.create(1);
    const id = (token: string) => sessions.find(token)!.id;
    const firstId = id(first);
    const secondId = id(second);
    expect(sessions.isActive(firstId)).toBe(true);

    expect(sessions.remove(second)).toBe(secondId);
    expect(sessions.isActive(secondId)).toBe(false);

    now += 1000;
    expect(sessions.isActive(firstId)).toBe(false);
  });

  test("stores only a hash of the token", async () => {
    const { db, signIn } = createTestAuth();
    const { cookie } = await signIn({ username: "ana" });
    const token = cookie.split("=")[1]!;
    const rows = db.prepare("SELECT token_hash FROM sessions").all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test("an expired session is not found and is deleted", async () => {
    let now = 1_000_000;
    const { db, sessions, signIn } = createTestAuth({
      clock: () => now,
      ttlMs: 1000,
    });
    const { cookie } = await signIn({ username: "ana" });
    const token = cookie.split("=")[1]!;
    now += 999;
    expect(sessions.find(token)).not.toBeNull();
    now += 1;
    expect(sessions.find(token)).toBeNull();
    expect(db.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({
      n: 0,
    });
  });

  test("the cookie is HttpOnly and SameSite=Strict; Secure only when asked", () => {
    const plain = sessionCookie("abc", { maxAgeMs: 60_000, secure: false });
    expect(plain).toBe(
      "tm_session=abc; HttpOnly; SameSite=Strict; Path=/; Max-Age=60",
    );
    expect(sessionCookie("abc", { maxAgeMs: 60_000, secure: true })).toMatch(
      /; Secure$/,
    );
  });
});

test("escapeHtml escapes the five special characters", () => {
  expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
    "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;",
  );
});

describe("safeNext", () => {
  test.each([
    ["/control/", "/control/"],
    ["/?rate=10", "/?rate=10"],
    [null, "/"],
    ["", "/"],
    ["control", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example", "/"],
    // Browsers remove tab and newline, so these would become "//evil.example".
    ["/\t/evil.example", "/"],
    ["/\n/evil.example", "/"],
    ["/\r/evil.example", "/"],
    ["/\u0000/evil.example", "/"],
    ["/\\/evil.example", "/"],
    ["/control/?view=open#top", "/control/?view=open#top"],
    ["/%09/evil.example", "/%09/evil.example"], // encoded: stays a path here
  ])("%j becomes %j", (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });
});

// ---- HTTP routes -------------------------------------------------------------

let servers: Server[] = [];
afterEach(() => {
  for (const server of servers) server.close();
  servers = [];
});

async function start(overrides: Partial<AuthDeps> = {}) {
  const testAuth = createTestAuth({ origin: ORIGIN });
  await testAuth.users.add({
    username: "ana",
    displayName: "Ana",
    password: "secret-1",
    roles: ["operator"],
  });
  const server = createHttpServer({
    staticDir: "/nonexistent",
    logger: silentLogger,
    auth: { ...testAuth.auth, ...overrides },
  });
  server.listen(0);
  await once(server, "listening");
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const login = (fields: Record<string, string>, origin = ORIGIN) =>
    fetch(`${base}/api/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields),
    });
  return { ...testAuth, base, login };
}

const cookieOf = (res: Response) =>
  res.headers.get("set-cookie")!.split(";")[0]!;

describe("login routes", () => {
  test("GET /login is a page without scripts that keeps a safe next", async () => {
    const { base } = await start();
    const res = await fetch(
      `${base}/login?next=${encodeURIComponent('/control/"><b>')}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    const html = await res.text();
    // The URL parser encodes the quote and brackets; the HTML stays intact.
    expect(html).toContain('value="/control/%22%3E%3Cb%3E"');
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script");
  });

  test("a correct login sets the session cookie and redirects to next", async () => {
    const { base, login } = await start();
    const res = await login({
      username: "ana",
      password: "secret-1",
      next: "/control/",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/control/");
    expect(res.headers.get("set-cookie")).toMatch(
      /^tm_session=[\w-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=3600$/,
    );

    const session = await fetch(`${base}/api/session`, {
      headers: { cookie: cookieOf(res) },
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({
      username: "ana",
      displayName: "Ana",
      roles: ["operator"],
    });
  });

  test("a JSON body works too", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/login`, {
      method: "POST",
      redirect: "manual",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ username: "ana", password: "secret-1" }),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });

  test("a wrong password and an unknown user get the same answer", async () => {
    const { login } = await start();
    const wrong = await login({ username: "ana", password: "nope" });
    const unknown = await login({ username: "bob", password: "nope" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect(await wrong.text()).toBe(await unknown.text());
  });

  test("next cannot point to another site", async () => {
    const { login } = await start();
    const res = await login({
      username: "ana",
      password: "secret-1",
      next: "//evil.example/",
    });
    expect(res.headers.get("location")).toBe("/");
  });

  // Regression: a TAB after the first slash passed the check, and browsers
  // removed it from the Location header, which gave "//evil.example".
  test("a tab in next cannot make an open redirect", async () => {
    const { login } = await start();
    const res = await login({
      username: "ana",
      password: "secret-1",
      next: "/\t/evil.example",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });

  test("a login from another origin is refused", async () => {
    const { login } = await start();
    const res = await login(
      { username: "ana", password: "secret-1" },
      "https://evil.example",
    );
    expect(res.status).toBe(403);
  });

  test("too many tries from one address are refused with 429", async () => {
    const { login } = await start({
      clock: () => 0,
      loginBucket: { capacity: 2, refillPerSecond: 1 },
    });
    await login({ username: "ana", password: "nope" });
    await login({ username: "ana", password: "nope" });
    // The right password does not help once the address is limited.
    const res = await login({ username: "ana", password: "secret-1" });
    expect(res.status).toBe(429);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("correct logins do not count against the limit", async () => {
    const { login } = await start({
      clock: () => 0,
      loginBucket: { capacity: 2, refillPerSecond: 1 },
    });
    for (let i = 0; i < 5; i++) {
      const res = await login({ username: "ana", password: "secret-1" });
      expect(res.status).toBe(303);
    }
  });

  test("a body above 4 KiB is refused", async () => {
    const { login } = await start();
    const res = await login({ username: "ana", password: "x".repeat(5000) });
    expect(res.status).toBe(413);
  });

  test("without a valid cookie, /api/session answers 401", async () => {
    const { base } = await start();
    expect((await fetch(`${base}/api/session`)).status).toBe(401);
    const forged = await fetch(`${base}/api/session`, {
      headers: { cookie: "tm_session=forged" },
    });
    expect(forged.status).toBe(401);
  });

  test("logout ends the session, clears the cookie and reports the session id", async () => {
    const onLogout = vi.fn();
    const { base, login } = await start({ onLogout });
    const cookie = cookieOf(
      await login({ username: "ana", password: "secret-1" }),
    );

    const res = await fetch(`${base}/api/logout`, {
      method: "POST",
      headers: { origin: ORIGIN, cookie },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/^tm_session=; .*Max-Age=0/);
    expect(onLogout).toHaveBeenCalledWith(expect.any(String));

    const after = await fetch(`${base}/api/session`, { headers: { cookie } });
    expect(after.status).toBe(401);
  });

  test("unknown /api routes are 404", async () => {
    const { base } = await start();
    expect((await fetch(`${base}/api/other`)).status).toBe(404);
  });
});
