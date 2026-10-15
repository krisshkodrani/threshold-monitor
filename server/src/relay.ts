import {
  encode,
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  PROTOCOL_VERSION,
  WELCOME_RECENT_LIMIT,
  type ServerMessage,
} from "@app/protocol";
import type { IncomingMessage, Server } from "node:http";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { AlertStore } from "./alertStore";
import { isOriginAllowed, type Config } from "./config";
import type { Logger } from "./logger";
import {
  createBucket,
  DEFAULT_BUCKET,
  take,
  type Bucket,
  type BucketConfig,
} from "./rateLimiter";
import { error, route, type Outgoing, type Role } from "./routing";
import type { Session } from "./sessions";
import type { UserRole } from "./users";

export type RelayDeps = {
  config: Pick<Config, "mode" | "allowedOrigins">;
  store: AlertStore;
  /** The session of an upgrade request, from its cookie. Null if there is none. */
  authenticate: (req: IncomingMessage) => Session | null;
  /** Checked on each heartbeat, so an expired or deleted session loses its sockets. */
  isSessionActive: (sessionId: string) => boolean;
  logger: Logger;
  clock?: () => number;
  newId?: () => string;
  helloTimeoutMs?: number;
  heartbeatMs?: number;
  bucket?: BucketConfig;
};

type Client = {
  id: string;
  ws: WebSocket;
  session: Session;
  role: Role | null; // null until a valid hello
  name: string;
  connectedAt: number;
  bucket: Bucket;
  limitedInARow: number;
  alive: boolean;
  helloTimer: ReturnType<typeof setTimeout>;
};

/** Close codes in the 4000-4999 range are free for applications. */
const CLOSE = {
  helloRequired: 4001,
  unsupportedVersion: 4002,
  unauthorized: 4003,
  rateLimited: 4008,
  goingAway: 1001,
};
const MAX_LIMITED_IN_A_ROW = 100;

/** The user role that a hello role needs. */
const NEEDED_ROLE: Record<Role, UserRole> = {
  monitor: "monitor",
  control: "operator",
};

/** Accepts WebSocket upgrades on /ws and relays messages between monitors and control rooms. */
export function attachRelay(server: Server, deps: RelayDeps) {
  const {
    config,
    store,
    authenticate,
    isSessionActive,
    logger,
    clock = Date.now,
    newId = () => crypto.randomUUID(),
    helloTimeoutMs = 5_000,
    heartbeatMs = 15_000,
    bucket: bucketConfig = DEFAULT_BUCKET,
  } = deps;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
  });
  const clients = new Set<Client>();
  const ctx = { store, now: () => new Date(clock()).toISOString() };

  function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    // Node hands "upgrade" sockets over without an error listener. Without
    // this, a client resetting the connection (e.g. after a 403) would be an
    // uncaught exception and take the whole server down.
    socket.on("error", (err) =>
      logger.debug("upgrade socket error", { error: err.message }),
    );

    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname !== "/ws") return reject(socket, "404 Not Found");
    if (!isOriginAllowed(req.headers.origin, req.headers.host, config)) {
      logger.warn("origin rejected", { origin: req.headers.origin });
      return reject(socket, "403 Forbidden");
    }
    const session = authenticate(req);
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, session));
  }

  function onConnection(ws: WebSocket, session: Session | null) {
    if (!session) {
      // A browser cannot read the status of a refused upgrade, but it can
      // read a close code: 4003 tells the app to show the login page.
      logger.info("unauthorized connection closed");
      return ws.close(CLOSE.unauthorized, "Unauthorized");
    }
    const client: Client = {
      id: newId(),
      ws,
      session,
      role: null,
      name: "",
      connectedAt: clock(),
      bucket: createBucket(clock(), bucketConfig),
      limitedInARow: 0,
      alive: true,
      helloTimer: setTimeout(
        () => ws.close(CLOSE.helloRequired, "Hello timeout"),
        helloTimeoutMs,
      ),
    };
    clients.add(client);

    ws.on("pong", () => (client.alive = true));
    ws.on("message", (data, isBinary) => onMessage(client, data, isBinary));
    ws.on("error", (err) =>
      logger.warn("socket error", {
        connectionId: client.id,
        error: err.message,
      }),
    );
    ws.on("close", (code) => {
      clearTimeout(client.helloTimer);
      clients.delete(client);
      logger.info("disconnected", {
        connectionId: client.id,
        role: client.role,
        name: client.name,
        code,
        durationMs: clock() - client.connectedAt,
      });
    });
  }

  function onMessage(client: Client, data: RawData, isBinary: boolean) {
    const limited = take(client.bucket, clock(), bucketConfig);
    client.bucket = limited.bucket;
    if (!limited.allowed) {
      client.limitedInARow += 1;
      send(
        client,
        error("RATE_LIMITED", "Too many messages; slow down.").message,
      );
      if (client.limitedInARow >= MAX_LIMITED_IN_A_ROW) {
        client.ws.close(CLOSE.rateLimited, "Rate limit exceeded");
      }
      return;
    }
    client.limitedInARow = 0;

    const parsed = isBinary ? null : parseClientMessage(toText(data));

    if (client.role === null) {
      // Nothing is accepted before a valid hello, not even a retry.
      if (!parsed?.ok || parsed.value.type !== "hello") {
        send(
          client,
          error("HELLO_REQUIRED", "The first message must be hello.").message,
        );
        return client.ws.close(CLOSE.helloRequired, "Hello required");
      }
      if (parsed.value.v !== PROTOCOL_VERSION) {
        send(
          client,
          error(
            "UNSUPPORTED_VERSION",
            `This server speaks version ${PROTOCOL_VERSION}.`,
          ).message,
        );
        return client.ws.close(CLOSE.unsupportedVersion, "Unsupported version");
      }
      clearTimeout(client.helloTimer);
      if (!client.session.roles.includes(NEEDED_ROLE[parsed.value.role])) {
        send(
          client,
          error(
            "NOT_ALLOWED",
            `This account cannot connect as ${parsed.value.role}.`,
          ).message,
        );
        logger.warn("role refused", {
          connectionId: client.id,
          username: client.session.username,
          role: parsed.value.role,
        });
        return client.ws.close(CLOSE.unauthorized, "Role not allowed");
      }
      // Role and name come only from the handshake, never from later messages.
      client.role = parsed.value.role;
      client.name = parsed.value.clientName;
      send(client, {
        type: "welcome",
        connectionId: client.id,
        recent: store.recent(WELCOME_RECENT_LIMIT),
      });
      logger.info("connected", {
        connectionId: client.id,
        role: client.role,
        name: client.name,
        username: client.session.username,
      });
      return;
    }

    if (!parsed?.ok) {
      // One bad message is reported, not punished: the connection stays open.
      const reason = parsed
        ? parsed.error.message
        : "Binary frames are not supported.";
      return send(client, error("BAD_MESSAGE", reason).message);
    }

    const sender = {
      role: client.role,
      operator: client.session.displayName,
      userId: client.session.userId,
    };
    for (const out of route(sender, parsed.value, ctx)) deliver(client, out);
  }

  function deliver(sender: Client, out: Outgoing) {
    const recipients =
      out.to === "sender"
        ? [sender]
        : [...clients].filter((c) =>
            out.to === "controls" ? c.role === "control" : c.role !== null,
          );
    for (const client of recipients) send(client, out.message);
    log(sender, out);
  }

  function log(sender: Client, { to, message }: Outgoing) {
    const base = {
      connectionId: sender.id,
      name: sender.name,
      username: sender.session.username,
    };
    if (message.type === "accepted") {
      logger.info("alert accepted", {
        ...base,
        alertId: message.alertId,
        duplicate: message.duplicate,
      });
    } else if (message.type === "acknowledged" && to === "everyone") {
      logger.info("alert acknowledged", {
        ...base,
        alertId: message.alertId,
        operator: message.operator,
      });
    } else if (message.type === "error") {
      logger.warn("client error", {
        ...base,
        code: message.code,
        ref: message.ref,
      });
    }
  }

  // Browsers answer pings automatically. A client that missed the previous
  // ping is gone (network dropped without a close frame) and is terminated.
  // A client whose session expired or was deleted is closed with 4003.
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!isSessionActive(client.session.id)) {
        logger.info("session ended, socket closed", {
          connectionId: client.id,
          username: client.session.username,
        });
        client.ws.close(CLOSE.unauthorized, "Session expired");
        continue;
      }
      if (!client.alive) {
        logger.warn("heartbeat missed", {
          connectionId: client.id,
          name: client.name,
        });
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }, heartbeatMs);

  server.on("upgrade", onUpgrade);

  return {
    /** Closes the sockets of a session after its logout, with 4003. */
    closeSession(sessionId: string) {
      for (const client of clients)
        if (client.session.id === sessionId)
          client.ws.close(CLOSE.unauthorized, "Signed out");
    },

    /** Stops accepting connections and closes every socket with 1001 "going away". */
    async close() {
      clearInterval(heartbeat);
      server.off("upgrade", onUpgrade);
      const closing = [...clients].map((client) => {
        client.ws.close(CLOSE.goingAway, "Server shutting down");
        return once(client.ws, "close");
      });
      await Promise.all(closing);
      wss.close();
    },
  };
}

function send(client: Client, message: ServerMessage) {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(encode(message));
}

function reject(socket: Duplex, status: string) {
  socket.end(
    `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

/** ws delivers a Buffer, an ArrayBuffer or fragments, depending on settings. */
function toText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
