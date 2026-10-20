import { existsSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import sirv from "sirv";
import { isOriginAllowed, type Config } from "./config";
import type { Logger } from "./logger";
import { loginPage } from "./loginPage";
import {
  createBucket,
  take,
  type Bucket,
  type BucketConfig,
} from "./rateLimiter";
import {
  authenticate,
  clearedSessionCookie,
  readSessionToken,
  sessionCookie,
  type SessionStore,
} from "./sessions";
import type { UserStore } from "./users";

export type AuthDeps = {
  users: UserStore;
  sessions: SessionStore;
  config: Pick<
    Config,
    "mode" | "allowedOrigins" | "cookieSecure" | "trustProxy"
  >;
  /** Called with the session id after a logout, so the relay can close its sockets. */
  onLogout?: (sessionId: string) => void;
  clock?: () => number;
  /** Login tries for each IP address: a short burst, then a slow refill. */
  loginBucket?: BucketConfig;
};

const LOGIN_BUCKET: BucketConfig = { capacity: 5, refillPerSecond: 0.1 };
const MAX_BODY_BYTES = 4 * 1024;
const MAX_TRACKED_ADDRESSES = 10_000;
const LOGIN_FAILED = "Wrong username or password.";

// The login page has no script, loads nothing and must not be framed.
const LOGIN_PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

/**
 * The two apps: scripts, styles and the WebSocket only from this origin.
 * The pages have no inline script or style (Vite builds files); React sets
 * style properties through the CSSOM, which CSP allows. `data:` is for the
 * empty favicon.
 */
export const APP_HEADERS = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

/** Vite puts a content hash in each asset name, so a file never changes. */
const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Plain HTTP: a health check, the login routes and the two built apps, so
 * production is one process on one port with no CORS (the pages, /api and
 * /ws share an origin). sirv does the details of the file server: content
 * types, ETags, protection against path traversal, and index.html as the
 * fallback for client routes. The apps are public files; their data comes only
 * through /ws, which needs a session.
 */
export function createHttpServer({
  staticDir,
  logger,
  auth,
  isReady = () => true,
}: {
  staticDir: string;
  logger: Logger;
  auth: AuthDeps;
  /** For /readyz: false while the database fails or the server stops. */
  isReady?: () => boolean;
}) {
  const monitor = serveApp(path.join(staticDir, "monitor", "dist"), logger);
  const control = serveApp(path.join(staticDir, "control", "dist"), logger);
  const architecture = serveApp(
    path.join(staticDir, "architecture-guide", "dist"),
    logger,
  );
  const routes = authRoutes(auth, logger);

  return createServer((req, res) => {
    const { pathname, searchParams } = new URL(
      req.url ?? "/",
      "http://localhost",
    );

    // The checks only read; a write to them is a mistake, so say so.
    const isCheck = pathname === "/healthz" || pathname === "/readyz";
    if (isCheck && req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      return res.end();
    }
    if (pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ status: "ok" }));
    }
    // Liveness (/healthz) says the process answers; readiness says it can
    // serve now. A load balancer sends traffic only to a ready instance.
    if (pathname === "/readyz") {
      const ready = isReady();
      return json(res, ready ? 200 : 503, {
        status: ready ? "ready" : "not ready",
      });
    }
    if (pathname === "/login" && req.method === "GET") {
      res.writeHead(200, LOGIN_PAGE_HEADERS);
      return res.end(loginPage({ next: safeNext(searchParams.get("next")) }));
    }
    if (pathname === "/api/login" && req.method === "POST") {
      // An aborted request rejects; it must not become an unhandled rejection.
      return void routes.login(req, res).catch((err: unknown) => {
        logger.warn("login request failed", { error: String(err) });
        if (!res.headersSent) json(res, 500, { error: "Login failed" });
        else res.destroy();
      });
    }
    if (pathname === "/api/logout" && req.method === "POST")
      return routes.logout(req, res);
    if (pathname === "/api/session" && req.method === "GET")
      return routes.session(req, res);
    if (pathname.startsWith("/api/"))
      return json(res, 404, { error: "Not found" });
    if (pathname === "/architecture") {
      res.writeHead(301, { location: "/architecture/" });
      return res.end();
    }
    if (pathname.startsWith("/architecture/")) {
      req.url = req.url!.slice("/architecture".length);
      return architecture
        ? architecture(req, res, () => notFound(res))
        : notFound(res);
    }
    if (pathname === "/control") {
      res.writeHead(301, { location: "/control/" });
      return res.end();
    }
    if (pathname.startsWith("/control/")) {
      // The control app is built with base "/control/"; strip it so sirv
      // looks inside control/dist.
      req.url = req.url!.slice("/control".length);
      return control ? control(req, res, () => notFound(res)) : notFound(res);
    }
    return monitor ? monitor(req, res, () => notFound(res)) : notFound(res);
  });
}

function authRoutes(auth: AuthDeps, logger: Logger) {
  const {
    users,
    sessions,
    config,
    onLogout,
    clock = Date.now,
    loginBucket = LOGIN_BUCKET,
  } = auth;
  const buckets = new Map<string, Bucket>();

  /**
   * Each try takes a token before the password check, so parallel tries
   * cannot all see the same full bucket. The map is cleared when it grows
   * too large, which only forgives.
   */
  function takeTry(address: string): boolean {
    if (buckets.size > MAX_TRACKED_ADDRESSES) buckets.clear();
    const now = clock();
    const result = take(
      buckets.get(address) ?? createBucket(now, loginBucket),
      now,
      loginBucket,
    );
    buckets.set(address, result.bucket);
    return result.allowed;
  }

  /** A correct login gives its token back, so people who know the password are never limited. */
  function giveBack(address: string) {
    const bucket = buckets.get(address);
    if (bucket)
      buckets.set(address, {
        ...bucket,
        tokens: Math.min(loginBucket.capacity, bucket.tokens + 1),
      });
  }

  /** The same Origin rule as the WebSocket upgrade: no posts from other sites. */
  const sameSite = (req: IncomingMessage) =>
    isOriginAllowed(req.headers.origin, req.headers.host, config);

  return {
    async login(req: IncomingMessage, res: ServerResponse) {
      if (!sameSite(req)) return json(res, 403, { error: "Forbidden origin" });
      const address = clientAddress(req, config.trustProxy);

      const body = await readForm(req);
      if (!body) return json(res, 413, { error: "Body too large" });
      const next = safeNext(body.get("next"));

      if (!takeTry(address)) {
        logger.warn("login rate limited", { address });
        res.writeHead(429, { ...LOGIN_PAGE_HEADERS, "retry-after": "10" });
        return res.end(
          loginPage({ next, error: "Too many tries. Wait, then try again." }),
        );
      }

      const username = body.get("username") ?? "";
      const user = await users.verify(username, body.get("password") ?? "");
      if (!user) {
        logger.warn("login failed", { address });
        res.writeHead(401, LOGIN_PAGE_HEADERS);
        return res.end(loginPage({ next, error: LOGIN_FAILED }));
      }

      giveBack(address);
      const token = sessions.create(user.id);
      logger.info("login", { userId: user.id, username: user.username });
      res.writeHead(303, {
        location: next,
        "set-cookie": sessionCookie(token, {
          maxAgeMs: sessions.ttlMs,
          secure: config.cookieSecure,
        }),
        "cache-control": "no-store",
      });
      res.end();
    },

    logout(req: IncomingMessage, res: ServerResponse) {
      if (!sameSite(req)) return json(res, 403, { error: "Forbidden origin" });
      const token = readSessionToken(req);
      if (token) {
        const sessionId = sessions.remove(token);
        onLogout?.(sessionId);
      }
      res.writeHead(204, {
        "set-cookie": clearedSessionCookie(config.cookieSecure),
        "cache-control": "no-store",
      });
      res.end();
    },

    session(req: IncomingMessage, res: ServerResponse) {
      const session = authenticate(req, sessions);
      if (!session) return json(res, 401, { error: "Not signed in" });
      const { username, displayName, roles } = session;
      json(res, 200, { username, displayName, roles });
    },
  };
}

// A base that no real request has, to see if a value leaves this server.
const LOCAL_BASE = "http://relay.invalid";

/**
 * Where to go after login. Only a path on this server: "//evil.example" or
 * "https://evil.example" would make the login page an open redirect.
 * Browsers remove tab and newline characters from a URL and read "\" as "/",
 * so "/<TAB>/evil.example" and "/\evil.example" are refused too. The URL
 * parser then makes the final check, the same way that a browser does.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return "/";
  // eslint-disable-next-line no-control-regex -- control characters are the point
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return "/";
  const url = new URL(next, LOCAL_BASE);
  if (url.origin !== LOCAL_BASE) return "/";
  return url.pathname + url.search + url.hash;
}

/** Reads a form or JSON body of at most 4 KiB. Null if it is larger. */
async function readForm(
  req: IncomingMessage,
): Promise<Map<string, string> | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const fields = new Map<string, string>();
  if (req.headers["content-type"]?.startsWith("application/json")) {
    try {
      const value: unknown = JSON.parse(text);
      if (value && typeof value === "object")
        for (const [key, field] of Object.entries(value))
          if (typeof field === "string") fields.set(key, field);
    } catch {
      // An invalid body has no fields; the login then fails as usual.
    }
    return fields;
  }
  for (const [key, field] of new URLSearchParams(text)) fields.set(key, field);
  return fields;
}

/**
 * The address for the login limit. Behind a reverse proxy, the socket address
 * is the proxy's, so all users would share one bucket. With `trustProxy`, the
 * last X-Forwarded-For entry is used: the proxy adds it, and a client cannot
 * change it. The earlier entries come from the client and are not trusted.
 */
export function clientAddress(
  req: IncomingMessage,
  trustProxy: boolean,
): string {
  const socketAddress = req.socket.remoteAddress ?? "unknown";
  if (!trustProxy) return socketAddress;
  const header = req.headers["x-forwarded-for"];
  const entries = (Array.isArray(header) ? header.join(",") : (header ?? ""))
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.at(-1) ?? socketAddress;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function serveApp(dir: string, logger: Logger) {
  if (!existsSync(path.join(dir, "index.html"))) {
    // Normal in development, where Vite serves the pages.
    logger.info("built app not found, not serving it", { dir });
    return null;
  }
  return sirv(dir, {
    single: true,
    etag: true,
    setHeaders(res, pathname) {
      for (const [name, value] of Object.entries(APP_HEADERS))
        res.setHeader(name, value);
      // index.html must be checked on each visit: it names the new assets.
      res.setHeader(
        "cache-control",
        pathname.startsWith("/assets/") ? IMMUTABLE : "no-cache",
      );
    },
  });
}

function notFound(res: ServerResponse) {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end(
    "Not found. In development, open the Vite dev servers on ports 5173 and 5174.",
  );
}
