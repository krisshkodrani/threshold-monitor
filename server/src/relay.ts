import {
  encode,
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  PROTOCOL_VERSION,
  WELCOME_RECENT_LIMIT,
  type Hello,
  type SensorInfo,
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
import { createReadingsBuffer } from "./readingsBuffer";
import { error, route, type Outgoing, type Role, type Sender } from "./routing";
import type { Session } from "./sessions";
import type { SettingsStore } from "./settingsStore";
import type { UserRole } from "./users";

export type RelayDeps = {
  config: Pick<Config, "mode" | "allowedOrigins">;
  store: AlertStore;
  settings: SettingsStore;
  /** True if `token` is the sensor token (SENSOR_TOKEN). False when none is set. */
  isSensorToken: (token: string) => boolean;
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
  /** The sensor sends 10 readings each second, so it has a larger bucket. */
  sensorBucket?: BucketConfig;
  /** Above this send buffer, a client gets no readings until it catches up. */
  maxBufferedBytes?: number;
  /** For tests: the send buffer of a client. Default: `ws.bufferedAmount`. */
  bufferedAmountOf?: (connectionId: string, ws: WebSocket) => number;
};

/**
 * A slow client (a weak network, a busy tab) cannot read 10 readings each
 * second. Without a limit, the relay keeps all of them in memory for it.
 */
export const MAX_BUFFERED_BYTES = 1024 * 1024;

/** Capacity for a catch-up burst; the refill is well above 10 readings each second. */
export const SENSOR_BUCKET: BucketConfig = {
  capacity: 600,
  refillPerSecond: 50,
};

type Client = {
  id: string;
  ws: WebSocket;
  /** The browser's session. Null for the sensor, which proves itself with a token. */
  session: Session | null;
  /** Set for the sensor after its hello. */
  sensor: SensorInfo | null;
  role: Role | null; // null until a valid hello
  bucketConfig: BucketConfig;
  name: string;
  connectedAt: number;
  bucket: Bucket;
  limitedInARow: number;
  /** True while the client gets no readings because its send buffer is full. */
  skipsReadings: boolean;
  alive: boolean;
  helloTimer: ReturnType<typeof setTimeout>;
};

/** Close codes in the 4000-4999 range are free for applications. */
const CLOSE = {
  helloRequired: 4001,
  unsupportedVersion: 4002,
  unauthorized: 4003,
  sensorTaken: 4005,
  rateLimited: 4008,
  goingAway: 1001,
};
const MAX_LIMITED_IN_A_ROW = 100;

/** The user role that a browser's hello role needs. */
const NEEDED_ROLE: Record<"monitor" | "control", UserRole> = {
  monitor: "monitor",
  control: "operator",
};

/** Accepts WebSocket upgrades on /ws and relays messages between the sensor, monitors and control rooms. */
export function attachRelay(server: Server, deps: RelayDeps) {
  const {
    config,
    store,
    settings,
    isSensorToken,
    authenticate,
    isSessionActive,
    logger,
    clock = Date.now,
    newId = () => crypto.randomUUID(),
    helloTimeoutMs = 5_000,
    heartbeatMs = 15_000,
    bucket: bucketConfig = DEFAULT_BUCKET,
    sensorBucket = SENSOR_BUCKET,
    maxBufferedBytes = MAX_BUFFERED_BYTES,
    bufferedAmountOf = (_id, ws) => ws.bufferedAmount,
  } = deps;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
  });
  const clients = new Set<Client>();
  const readings = createReadingsBuffer();
  const sensorClient = () =>
    [...clients].find((c) => c.role === "sensor") ?? null;
  const ctx = {
    store,
    settings,
    readings,
    sensor: () => sensorClient()?.sensor ?? null,
    now: () => new Date(clock()).toISOString(),
  };

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

  // A socket without a session may connect: the sensor proves itself in its
  // hello. A browser without a session is closed at its hello with 4003.
  function onConnection(ws: WebSocket, session: Session | null) {
    const client: Client = {
      id: newId(),
      ws,
      session,
      sensor: null,
      role: null,
      bucketConfig,
      name: "",
      connectedAt: clock(),
      bucket: createBucket(clock(), bucketConfig),
      limitedInARow: 0,
      skipsReadings: false,
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
      if (client.role === "sensor") {
        // Without a sensor, old readings would look like live data.
        readings.clear();
        broadcastSensorStatus();
      }
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
    const limited = take(client.bucket, clock(), client.bucketConfig);
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
      return onHello(client, parsed.value);
    }

    if (!parsed?.ok) {
      // One bad message is reported, not punished: the connection stays open.
      const reason = parsed
        ? parsed.error.message
        : "Binary frames are not supported.";
      return send(client, error("BAD_MESSAGE", reason).message);
    }

    for (const out of route(senderOf(client), parsed.value, ctx))
      deliver(client, out);
  }

  function senderOf(client: Client): Sender {
    if (client.role === "sensor")
      return { role: "sensor", sensor: client.sensor! };
    return {
      role: client.role!,
      operator: client.session!.displayName,
      userId: client.session!.userId,
    };
  }

  function refuse(
    client: Client,
    message: string,
    code: number,
    reason: string,
  ) {
    send(client, error("NOT_ALLOWED", message).message);
    logger.warn("hello refused", {
      connectionId: client.id,
      username: client.session?.username,
      reason,
    });
    client.ws.close(code, reason);
  }

  function onHello(client: Client, hello: Hello) {
    if (hello.role === "sensor") {
      if (!hello.token || !hello.sensor || !isSensorToken(hello.token))
        return refuse(
          client,
          "Invalid sensor token.",
          CLOSE.unauthorized,
          "Unauthorized",
        );
      const old = sensorClient();
      if (old && old.sensor?.sensorId !== hello.sensor.sensorId)
        return refuse(
          client,
          "A sensor is already connected.",
          CLOSE.sensorTaken,
          "Sensor already connected",
        );
      if (old) {
        // The same sensor again: its old socket is half-open after a network
        // drop. Replace it now, not after the heartbeat finds it dead.
        logger.warn("sensor replaced its old connection", {
          connectionId: old.id,
        });
        old.role = null; // so its close event does not report "offline"
        clients.delete(old);
        old.ws.terminate();
      }
      client.sensor = hello.sensor;
      client.bucketConfig = sensorBucket;
      client.bucket = createBucket(clock(), sensorBucket);
    } else {
      if (!client.session)
        // A browser cannot read the status of a refused upgrade, but it can
        // read a close code: 4003 tells the app to show the login page.
        return refuse(
          client,
          "Sign in first.",
          CLOSE.unauthorized,
          "Unauthorized",
        );
      if (!client.session.roles.includes(NEEDED_ROLE[hello.role]))
        return refuse(
          client,
          `This account cannot connect as ${hello.role}.`,
          CLOSE.unauthorized,
          "Role not allowed",
        );
    }

    // Role and name come only from the handshake, never from later messages.
    client.role = hello.role;
    client.name = hello.clientName;
    const sensor = ctx.sensor();
    const recent = store.recent(WELCOME_RECENT_LIMIT);
    send(client, {
      type: "welcome",
      connectionId: client.id,
      // The sensor gets its own alerts, so it does not send again the ones
      // whose `accepted` it lost (ADR 0004).
      recent:
        client.role === "sensor"
          ? recent.filter((r) => r.sourceId === client.sensor!.sensorId)
          : recent,
      settings: currentSettings(),
      sensor,
      readings: client.role === "monitor" ? readings.all() : [],
    });
    logger.info("connected", {
      connectionId: client.id,
      role: client.role,
      name: client.name,
      username: client.session?.username,
    });
    if (client.role === "sensor") {
      readings.clear(); // old readings would leave a gap in the chart
      broadcastSensorStatus();
      // The monitors may show the settings of an earlier sensor.
      const stored = currentSettings();
      if (stored)
        for (const c of clients)
          if (c.role === "monitor")
            send(c, { type: "settings", settings: stored });
    }
  }

  /** The settings of the connected sensor; without a sensor, the last stored ones. */
  function currentSettings() {
    const sensor = ctx.sensor();
    return sensor
      ? (settings.get(sensor.sensorId) ?? null)
      : (settings.latest()?.settings ?? null);
  }

  function broadcastSensorStatus() {
    const message: ServerMessage = {
      type: "sensorStatus",
      sensor: ctx.sensor(),
    };
    for (const client of clients)
      if (client.role !== null && client.role !== "sensor")
        send(client, message);
    logger.info(message.sensor ? "sensor online" : "sensor offline", {
      sensorId: message.sensor?.sensorId,
    });
  }

  function deliver(sender: Client, out: Outgoing) {
    const recipients =
      out.to === "sender"
        ? [sender]
        : [...clients].filter((c) => receives(c, out.to));
    for (const client of recipients)
      if (out.message.type !== "reading" || canTakeReading(client))
        send(client, out.message);
    log(sender, out);
  }

  /** Readings are at most once, so a slow client skips them. Alerts never. */
  function canTakeReading(client: Client): boolean {
    const slow = bufferedAmountOf(client.id, client.ws) > maxBufferedBytes;
    if (slow !== client.skipsReadings) {
      client.skipsReadings = slow;
      logger.warn(slow ? "slow client, readings skipped" : "client caught up", {
        connectionId: client.id,
        name: client.name,
      });
    }
    return !slow;
  }

  function log(sender: Client, { to, message }: Outgoing) {
    const base = {
      connectionId: sender.id,
      name: sender.name,
      username: sender.session?.username,
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
    } else if (message.type === "settings" && to === "monitors") {
      logger.info("settings changed", {
        ...base,
        threshold: message.settings.threshold,
        hysteresis: message.settings.hysteresis,
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
      // The sensor has no session; its token is checked once, at hello.
      if (client.session && !isSessionActive(client.session.id)) {
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
        if (client.session?.id === sessionId)
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

/** Which clients a target names. Clients before their hello receive nothing. */
function receives(client: Client, to: Outgoing["to"]): boolean {
  switch (to) {
    case "sender":
      return false; // handled by the caller
    case "monitors":
      return client.role === "monitor";
    case "views":
      return client.role === "monitor" || client.role === "control";
    case "sensor":
      return client.role === "sensor";
    case "everyone":
      return client.role !== null;
  }
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
