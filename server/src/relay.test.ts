import type { Alert, ServerMessage } from "@app/protocol";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { connect as tcpConnect, type AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { createMemoryAlertStore } from "./alertStore";
import { createLogger, silentLogger } from "./logger";
import { attachRelay, type RelayDeps } from "./relay";
import { createMemorySettingsStore } from "./settingsStore";
import type { Session } from "./sessions";

const ORIGIN = "http://test.local";
const ALERT_ID = "3f0c6a8e-6b1d-4c2a-9f4e-2a7d5b9c1e01";

const alert: Alert = {
  id: ALERT_ID,
  sourceId: "5d0a2f6e-1c3b-4e7a-9b8d-2f4e6a8c0b13", // the test sensor's id
  sourceLabel: "Sensor 1",
  metric: "temperature",
  unit: "°C",
  threshold: 25,
  hysteresis: 0.6,
  value: 25.4,
  direction: "up",
  eventTime: "2026-10-14T09:30:00.000Z",
};

// ---- harness: a real HTTP server with the relay on a random port ----------

/** Fake sessions, keyed by the whole Cookie header. */
const SESSIONS: Record<string, Session> = {
  "tm_session=ana": {
    id: "session-ana",
    userId: 1,
    username: "ana",
    displayName: "Ana",
    roles: ["operator", "monitor"],
  },
  "tm_session=ben": {
    id: "session-ben",
    userId: 2,
    username: "ben",
    displayName: "Ben",
    roles: ["operator"],
  },
  "tm_session=device": {
    id: "session-device",
    userId: 3,
    username: "device",
    displayName: "Device",
    roles: ["monitor"],
  },
};
const ANA = "tm_session=ana";
const SENSOR_TOKEN = "test-sensor-token-0123456789";
const OTHER_SENSOR_ID = "9c4b1e2a-7d3f-4a6b-8e5c-1f2a3b4c5d6e";
const SENSOR = {
  sensorId: "5d0a2f6e-1c3b-4e7a-9b8d-2f4e6a8c0b13",
  label: "Sensor 1",
  rateHz: 10,
};

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function startRelay(overrides: Partial<RelayDeps> = {}) {
  const server: Server = createServer();
  const relay = attachRelay(server, {
    config: { mode: "test", allowedOrigins: [ORIGIN] },
    store: createMemoryAlertStore(100),
    logger: silentLogger,
    settings: createMemorySettingsStore(),
    isSensorToken: (token) => token === SENSOR_TOKEN,
    authenticate: (req) => SESSIONS[req.headers.cookie ?? ""] ?? null,
    isSessionActive: () => true,
    ...overrides,
  });
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  let closed = false;
  const stop = async () => {
    if (!closed) await relay.close();
    closed = true;
    server.closeAllConnections();
    server.close();
  };
  cleanup.push(stop);
  return { url: `ws://127.0.0.1:${port}/ws`, port, relay, stop: stop };
}

type TestClient = Awaited<ReturnType<typeof connect>>;

/** A ws client that queues incoming messages so tests can await them in order. */
async function connect(
  url: string,
  options: {
    origin?: string;
    autoPong?: boolean;
    cookie?: string;
    /** Message types that next() skips; by default the sensor's status. */
    skip?: ServerMessage["type"][];
  } = {},
) {
  const skip = new Set(options.skip ?? ["sensorStatus"]);
  const cookie = options.cookie ?? ANA;
  const ws = new WebSocket(url, {
    origin: options.origin ?? ORIGIN,
    autoPong: options.autoPong ?? true,
    headers: cookie ? { cookie } : {},
  });
  const inbox: ServerMessage[] = [];
  const waiting: ((m: ServerMessage) => void)[] = [];
  ws.on("message", (data) => {
    const message = JSON.parse(
      (data as Buffer).toString("utf8"),
    ) as ServerMessage;
    if (skip.has(message.type)) return;
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else inbox.push(message);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.on("close", (code, reason) => resolve({ code, reason: String(reason) })),
  );
  await once(ws, "open");
  cleanup.push(async () => {
    if (ws.readyState !== WebSocket.CLOSED) {
      ws.terminate();
      await closed;
    }
  });

  return {
    ws,
    closed,
    send: (message: unknown) =>
      ws.send(typeof message === "string" ? message : JSON.stringify(message)),
    next: () =>
      new Promise<ServerMessage>((resolve, reject) => {
        const queued = inbox.shift();
        if (queued) return resolve(queued);
        const timer = setTimeout(
          () => reject(new Error("no message within 2 s")),
          2000,
        );
        waiting.push((m) => {
          clearTimeout(timer);
          resolve(m);
        });
      }),
    /** Resolves true if nothing arrives within `ms`. */
    silentFor: async (ms: number) => {
      await new Promise((r) => setTimeout(r, ms));
      return inbox.length === 0;
    },
  };
}

async function hello(
  url: string,
  role: "monitor" | "control",
  name: string = role,
  cookie: string = ANA,
): Promise<TestClient> {
  const client = await connect(url, { cookie });
  client.send({ type: "hello", v: 3, role, clientName: name });
  expect(await client.next()).toMatchObject({ type: "welcome" });
  return client;
}

/** The sensor: no cookie, a token in its hello. */
async function sensorHello(
  url: string,
  token = SENSOR_TOKEN,
): Promise<TestClient> {
  const client = await connect(url, { cookie: "" });
  client.send({
    type: "hello",
    v: 3,
    role: "sensor",
    clientName: SENSOR.label,
    token,
    sensor: SENSOR,
  });
  expect(await client.next()).toMatchObject({ type: "welcome" });
  return client;
}

/** HTTP status of an upgrade the server refuses. */
async function upgradeStatus(url: string, origin: string): Promise<number> {
  const ws = new WebSocket(url, { origin });
  // Aborting a refused handshake emits "error"; it is expected here.
  ws.on("error", () => {});
  const [, response] = (await once(ws, "unexpected-response")) as [
    unknown,
    { statusCode: number },
  ];
  ws.terminate();
  return response.statusCode;
}

// ---- tests -----------------------------------------------------------------

describe("handshake", () => {
  test("hello is answered with welcome", async () => {
    const { url } = await startRelay({
      newId: () => "c4a7e9b2-5f18-4d3c-8a6e-0b9d2f1c7e03",
    });
    const client = await connect(url);
    client.send({
      type: "hello",
      v: 3,
      role: "monitor",
      clientName: "Monitor A",
    });
    expect(await client.next()).toEqual({
      type: "welcome",
      connectionId: "c4a7e9b2-5f18-4d3c-8a6e-0b9d2f1c7e03",
      recent: [],
      settings: null,
      sensor: null,
      readings: [],
    });
  });

  test("any other first message is refused and the socket closed with 4001", async () => {
    const { url } = await startRelay();
    const client = await connect(url);
    client.send({ type: "ack", alertId: ALERT_ID });
    expect(await client.next()).toMatchObject({
      type: "error",
      code: "HELLO_REQUIRED",
    });
    expect((await client.closed).code).toBe(4001);
  });

  test("no hello in time closes with 4001", async () => {
    const { url } = await startRelay({ helloTimeoutMs: 50 });
    const client = await connect(url);
    expect(await client.closed).toEqual({
      code: 4001,
      reason: "Hello timeout",
    });
  });

  test("an unsupported protocol version is refused with 4002", async () => {
    const { url } = await startRelay();
    const client = await connect(url);
    client.send({ type: "hello", v: 4, role: "monitor", clientName: "Future" });
    expect(await client.next()).toMatchObject({
      type: "error",
      code: "UNSUPPORTED_VERSION",
    });
    expect((await client.closed).code).toBe(4002);
  });

  test("an upgrade from a foreign origin is rejected with HTTP 403", async () => {
    const { url } = await startRelay();
    expect(await upgradeStatus(url, "https://evil.example")).toBe(403);
  });

  test("upgrades on other paths are rejected with 404", async () => {
    const { port } = await startRelay();
    expect(await upgradeStatus(`ws://127.0.0.1:${port}/other`, ORIGIN)).toBe(
      404,
    );
  });
});

describe("sessions", () => {
  // The sensor has no cookie, so a socket without a session may open; a
  // browser hello without a session is refused.
  test("a browser hello without a session is closed with 4003", async () => {
    const { url } = await startRelay();
    const client = await connect(url, { cookie: "" });
    client.send({ type: "hello", v: 3, role: "control", clientName: "x" });
    expect(await client.next()).toMatchObject({ code: "NOT_ALLOWED" });
    expect(await client.closed).toEqual({ code: 4003, reason: "Unauthorized" });
  });

  test("a forged or expired cookie is closed with 4003", async () => {
    const { url } = await startRelay();
    const client = await connect(url, { cookie: "tm_session=forged" });
    client.send({ type: "hello", v: 3, role: "monitor", clientName: "x" });
    expect((await client.closed).code).toBe(4003);
  });

  test("hello needs the matching user role", async () => {
    const { url } = await startRelay();
    const device = await connect(url, { cookie: "tm_session=device" });
    device.send({ type: "hello", v: 3, role: "control", clientName: "x" });
    expect(await device.next()).toMatchObject({
      type: "error",
      code: "NOT_ALLOWED",
    });
    expect((await device.closed).code).toBe(4003);

    const ben = await connect(url, { cookie: "tm_session=ben" });
    ben.send({ type: "hello", v: 3, role: "monitor", clientName: "x" });
    expect(await ben.next()).toMatchObject({ code: "NOT_ALLOWED" });
    expect((await ben.closed).code).toBe(4003);
  });

  test("the operator name comes from the session, not from the message", async () => {
    const { url } = await startRelay();
    const control = await hello(url, "control", "C", "tm_session=ben");
    const sensor = await sensorHello(url);
    sensor.send({ type: "alert", alert });
    await sensor.next();
    await control.next();

    control.send({ type: "ack", alertId: ALERT_ID, operator: "Mallory" });
    expect(await control.next()).toMatchObject({
      type: "acknowledged",
      operator: "Ben",
    });
  });

  test("a session that ends while connected is closed on the next heartbeat", async () => {
    const ended = new Set<string>();
    const { url } = await startRelay({
      heartbeatMs: 40,
      isSessionActive: (id) => !ended.has(id),
    });
    const ana = await hello(url, "control", "A");
    const ben = await hello(url, "control", "B", "tm_session=ben");
    ended.add("session-ana");
    expect(await ana.closed).toEqual({ code: 4003, reason: "Session expired" });
    expect(ben.ws.readyState).toBe(WebSocket.OPEN);
  });

  test("closeSession closes only the sockets of that session, with 4003", async () => {
    const { url, relay } = await startRelay();
    const ana = await hello(url, "control", "A");
    const ben = await hello(url, "control", "B", "tm_session=ben");
    relay.closeSession("session-ana");
    expect(await ana.closed).toEqual({ code: 4003, reason: "Signed out" });
    expect(ben.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe("sensor", () => {
  test("a sensor with a wrong token is closed with 4003", async () => {
    const { url } = await startRelay();
    const client = await connect(url, { cookie: "" });
    client.send({
      type: "hello",
      v: 3,
      role: "sensor",
      clientName: "Fake",
      token: "wrong-token-wrong-token",
      sensor: SENSOR,
    });
    expect(await client.next()).toMatchObject({ code: "NOT_ALLOWED" });
    expect((await client.closed).code).toBe(4003);
  });

  test("a second sensor is refused with 4005 while one is connected", async () => {
    const { url } = await startRelay();
    await sensorHello(url);
    const second = await connect(url, { cookie: "" });
    second.send({
      type: "hello",
      v: 3,
      role: "sensor",
      clientName: "Second",
      token: SENSOR_TOKEN,
      sensor: { ...SENSOR, sensorId: OTHER_SENSOR_ID },
    });
    expect(await second.next()).toMatchObject({ code: "NOT_ALLOWED" });
    expect((await second.closed).code).toBe(4005);
  });

  // Regression: after a network drop, the old socket stays open until the
  // heartbeat finds it dead, and the sensor was refused with 4005 until then.
  test("the same sensor replaces its old connection at once", async () => {
    const { url } = await startRelay();
    const old = await sensorHello(url);
    const monitor = await connect(url, { skip: [] });
    monitor.send({ type: "hello", v: 3, role: "monitor", clientName: "M" });
    expect(await monitor.next()).toMatchObject({ type: "welcome" });

    const again = await sensorHello(url);
    expect((await old.closed).code).toBe(1006); // terminated
    // The monitors see the sensor come again, never "offline".
    expect(await monitor.next()).toEqual({
      type: "sensorStatus",
      sensor: SENSOR,
    });
    expect(await monitor.silentFor(100)).toBe(true);
    expect(again.ws.readyState).toBe(WebSocket.OPEN);
  });

  test("the sensor's welcome has its own recent alerts, so it does not send them again", async () => {
    const { url } = await startRelay();
    const sensor = await sensorHello(url);
    sensor.send({ type: "alert", alert });
    expect(await sensor.next()).toMatchObject({ type: "accepted" });
    sensor.ws.close();
    await sensor.closed;

    const again = await connect(url, { cookie: "" });
    again.send({
      type: "hello",
      v: 3,
      role: "sensor",
      clientName: SENSOR.label,
      token: SENSOR_TOKEN,
      sensor: { ...SENSOR, sensorId: alert.sourceId },
    });
    const welcome = await again.next();
    expect(welcome).toMatchObject({ type: "welcome" });
    expect(
      welcome.type === "welcome" && welcome.recent.map((r) => r.id),
    ).toEqual([ALERT_ID]);

    // Another sensor id gets none of them.
    again.ws.close();
    await again.closed;
    const other = await connect(url, { cookie: "" });
    other.send({
      type: "hello",
      v: 3,
      role: "sensor",
      clientName: "Other",
      token: SENSOR_TOKEN,
      sensor: { ...SENSOR, sensorId: OTHER_SENSOR_ID },
    });
    expect(await other.next()).toMatchObject({ type: "welcome", recent: [] });
  });

  // Regression: the buffer was cleared only when a sensor connected, so a
  // monitor that opened later showed old readings as live data.
  test("the readings are cleared when the sensor goes", async () => {
    const { url } = await startRelay();
    const sensor = await sensorHello(url);
    const monitor = await hello(url, "monitor");
    const reading = { t: 1_791_000_000_000, value: 24.5 };
    sensor.send({ type: "reading", reading });
    expect(await monitor.next()).toEqual({ type: "reading", reading });
    sensor.ws.close();
    await sensor.closed;
    await new Promise((r) => setTimeout(r, 50)); // the relay sees the close

    const late = await connect(url);
    late.send({ type: "hello", v: 3, role: "monitor", clientName: "Late" });
    expect(await late.next()).toMatchObject({
      type: "welcome",
      sensor: null,
      readings: [],
    });
  });

  // Regression: welcome used the last stored settings of any sensor, not the
  // settings of the connected one.
  test("monitors get the settings of the sensor that connects", async () => {
    const { url } = await startRelay();
    const connectSensor = async (sensorId: string) => {
      const client = await connect(url, { cookie: "" });
      client.send({
        type: "hello",
        v: 3,
        role: "sensor",
        clientName: SENSOR.label,
        token: SENSOR_TOKEN,
        sensor: { ...SENSOR, sensorId },
      });
      expect(await client.next()).toMatchObject({ type: "welcome" });
      return client;
    };
    // Sensor A stores 30, then sensor B stores 25 (the latest).
    const a = await connectSensor(SENSOR.sensorId);
    a.send({
      type: "settingsApplied",
      settings: { threshold: 30, hysteresis: 0.6 },
    });
    await new Promise((r) => setTimeout(r, 50));
    a.ws.close();
    await a.closed;
    const b = await connectSensor(OTHER_SENSOR_ID);
    b.send({
      type: "settingsApplied",
      settings: { threshold: 25, hysteresis: 0.6 },
    });
    await new Promise((r) => setTimeout(r, 50));
    b.ws.close();
    await b.closed;
    await new Promise((r) => setTimeout(r, 50));

    const monitor = await connect(url);
    monitor.send({ type: "hello", v: 3, role: "monitor", clientName: "M" });
    expect(await monitor.next()).toMatchObject({
      type: "welcome",
      settings: { threshold: 25 },
    });

    // Sensor A comes back with its stored settings and sends none.
    await connectSensor(SENSOR.sensorId);
    expect(await monitor.next()).toMatchObject({
      type: "settings",
      settings: { threshold: 30 },
    });
    const late = await connect(url);
    late.send({ type: "hello", v: 3, role: "monitor", clientName: "Late" });
    expect(await late.next()).toMatchObject({
      type: "welcome",
      settings: { threshold: 30 },
    });
  });

  test("monitors and control rooms learn when the sensor comes and goes", async () => {
    const { url } = await startRelay();
    const monitor = await connect(url, { skip: [] });
    monitor.send({ type: "hello", v: 3, role: "monitor", clientName: "M" });
    expect(await monitor.next()).toMatchObject({
      type: "welcome",
      sensor: null,
    });

    const sensor = await sensorHello(url);
    expect(await monitor.next()).toEqual({
      type: "sensorStatus",
      sensor: SENSOR,
    });
    sensor.ws.close();
    expect(await monitor.next()).toEqual({
      type: "sensorStatus",
      sensor: null,
    });
  });

  test("readings go to monitors only, and a new monitor gets the last ones", async () => {
    const { url } = await startRelay();
    const sensor = await sensorHello(url);
    const monitor = await hello(url, "monitor");
    const control = await hello(url, "control");

    const reading = { t: 1_791_000_000_000, value: 24.5 };
    sensor.send({ type: "reading", reading });
    expect(await monitor.next()).toEqual({ type: "reading", reading });
    expect(await control.silentFor(100)).toBe(true);

    const late = await connect(url);
    late.send({ type: "hello", v: 3, role: "monitor", clientName: "Late" });
    expect(await late.next()).toMatchObject({
      type: "welcome",
      sensor: SENSOR,
      readings: [reading],
    });
  });

  test("a slow monitor skips readings, but still gets alerts", async () => {
    const slow = new Set<string>();
    const logs: { msg: string; connectionId?: string }[] = [];
    const { url } = await startRelay({
      maxBufferedBytes: 1024,
      // A full send buffer for the slow monitor only.
      bufferedAmountOf: (id, ws) => (slow.has(id) ? 1e6 : ws.bufferedAmount),
      logger: createLogger("warn", (line) =>
        logs.push(JSON.parse(line) as { msg: string }),
      ),
    });
    const sensor = await sensorHello(url);
    const monitorWithId = async (name: string) => {
      const client = await connect(url);
      client.send({ type: "hello", v: 3, role: "monitor", clientName: name });
      const welcome = await client.next();
      if (welcome.type !== "welcome") throw new Error("no welcome");
      return { client, id: welcome.connectionId };
    };
    const fast = await monitorWithId("Fast");
    const behind = await monitorWithId("Slow");
    slow.add(behind.id);

    const reading = { t: 1_791_000_000_000, value: 24.5 };
    sensor.send({ type: "reading", reading });
    sensor.send({ type: "alert", alert });
    expect(await fast.client.next()).toEqual({ type: "reading", reading });
    expect(await fast.client.next()).toMatchObject({ type: "alert" });
    expect(await behind.client.next()).toMatchObject({ type: "alert" });
    expect(logs).toContainEqual(
      expect.objectContaining({
        msg: "slow client, readings skipped",
        connectionId: behind.id,
      }),
    );

    // When its buffer is empty again, it gets the readings again.
    slow.delete(behind.id);
    sensor.send({ type: "reading", reading });
    expect(await behind.client.next()).toEqual({ type: "reading", reading });
    expect(logs).toContainEqual(
      expect.objectContaining({
        msg: "client caught up",
        connectionId: behind.id,
      }),
    );
  });

  test("alerts reach monitors as well as control rooms", async () => {
    const { url } = await startRelay();
    const sensor = await sensorHello(url);
    const monitor = await hello(url, "monitor");
    sensor.send({ type: "alert", alert });
    expect(await monitor.next()).toMatchObject({
      type: "alert",
      record: { id: ALERT_ID },
    });
  });

  test("a settings change goes to the sensor and all monitors; a new sensor gets it in welcome", async () => {
    const { url } = await startRelay();
    const sensor = await sensorHello(url);
    sensor.send({
      type: "settingsApplied",
      settings: { threshold: 25, hysteresis: 0.6 },
    });
    const monitor = await hello(url, "monitor");

    monitor.send({
      type: "setSettings",
      settings: { threshold: 22, hysteresis: 0.2 },
    });
    const expected = {
      type: "settings",
      settings: { threshold: 22, hysteresis: 0.2, updatedBy: "Ana" },
    };
    expect(await sensor.next()).toMatchObject(expected);
    expect(await monitor.next()).toMatchObject(expected);

    sensor.ws.close();
    await sensor.closed;
    const restarted = await connect(url, { cookie: "" });
    restarted.send({
      type: "hello",
      v: 3,
      role: "sensor",
      clientName: SENSOR.label,
      token: SENSOR_TOKEN,
      sensor: SENSOR,
    });
    expect(await restarted.next()).toMatchObject({
      type: "welcome",
      settings: { threshold: 22, hysteresis: 0.2, updatedBy: "Ana" },
    });
  });

  test("the heartbeat session check does not close the sensor", async () => {
    const { url } = await startRelay({
      heartbeatMs: 40,
      isSessionActive: () => false,
    });
    const sensor = await sensorHello(url);
    await new Promise((r) => setTimeout(r, 150));
    expect(sensor.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe("routing", () => {
  test("an alert is accepted for the monitor and forwarded to every control room", async () => {
    const { url } = await startRelay();
    const controlA = await hello(url, "control", "A");
    const controlB = await hello(url, "control", "B");
    const sensor = await sensorHello(url);

    sensor.send({ type: "alert", alert });
    expect(await sensor.next()).toMatchObject({
      type: "accepted",
      alertId: ALERT_ID,
      duplicate: false,
    });
    for (const control of [controlA, controlB]) {
      expect(await control.next()).toMatchObject({
        type: "alert",
        record: { ...alert, acknowledgement: null },
      });
    }
  });

  test("a resent alert is accepted as duplicate and not forwarded again", async () => {
    const { url } = await startRelay();
    const control = await hello(url, "control");
    const sensor = await sensorHello(url);

    sensor.send({ type: "alert", alert });
    await sensor.next();
    await control.next();

    sensor.send({ type: "alert", alert });
    expect(await sensor.next()).toMatchObject({
      type: "accepted",
      duplicate: true,
    });
    expect(await control.silentFor(100)).toBe(true);
  });

  test("an acknowledgement reaches the monitor and all control rooms", async () => {
    const { url } = await startRelay();
    const controlA = await hello(url, "control", "A");
    const controlB = await hello(url, "control", "B");
    const sensor = await sensorHello(url);
    sensor.send({ type: "alert", alert });
    await sensor.next();
    await controlA.next();
    await controlB.next();

    controlA.send({ type: "ack", alertId: ALERT_ID });
    for (const client of [sensor, controlA, controlB]) {
      expect(await client.next()).toMatchObject({
        type: "acknowledged",
        alertId: ALERT_ID,
        operator: "Ana",
      });
    }
  });

  test("roles are enforced: a monitor cannot acknowledge", async () => {
    const { url } = await startRelay();
    const monitor = await hello(url, "monitor");
    monitor.send({ type: "ack", alertId: ALERT_ID });
    expect(await monitor.next()).toMatchObject({
      type: "error",
      code: "NOT_ALLOWED",
    });
  });

  test("acknowledging an unknown alert is reported", async () => {
    const { url } = await startRelay();
    const control = await hello(url, "control");
    control.send({ type: "ack", alertId: ALERT_ID });
    expect(await control.next()).toMatchObject({
      type: "error",
      code: "UNKNOWN_ALERT",
      ref: ALERT_ID,
    });
  });

  test("a client that connects later gets recent alerts in its welcome", async () => {
    const { url } = await startRelay();
    const sensor = await sensorHello(url);
    sensor.send({ type: "alert", alert });
    await sensor.next();

    const late = await connect(url);
    late.send({ type: "hello", v: 3, role: "control", clientName: "Late" });
    expect(await late.next()).toMatchObject({
      type: "welcome",
      recent: [{ id: ALERT_ID }],
    });
  });
});

describe("robustness", () => {
  // Regression: found by a manual smoke test. Node removes its own error
  // handling from sockets handed to "upgrade" listeners; a client resetting
  // the connection after a refused upgrade raised an uncaught ECONNRESET
  // and killed the whole server.
  test("a client resetting the connection after a refused upgrade does not crash the server", async () => {
    const { port, url } = await startRelay();
    const socket = tcpConnect(port, "127.0.0.1");
    await once(socket, "connect");
    socket.write(
      "GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: https://evil.example\r\n" +
        "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    );
    await once(socket, "data"); // the 403
    socket.resetAndDestroy(); // TCP RST instead of a clean close
    await new Promise((r) => setTimeout(r, 100));

    // Still alive and serving.
    await hello(url, "monitor");
  });

  test.each([
    ["invalid JSON", "{not json"],
    ["an unknown type", JSON.stringify({ type: "subscribe" })],
    [
      "an out-of-range value",
      JSON.stringify({ type: "alert", alert: { ...alert, value: 1e9 } }),
    ],
  ])(
    "%s gets BAD_MESSAGE and the connection stays open",
    async (_label, raw) => {
      const { url } = await startRelay();
      const sensor = await sensorHello(url);
      sensor.send(raw);
      expect(await sensor.next()).toMatchObject({
        type: "error",
        code: "BAD_MESSAGE",
      });

      sensor.send({ type: "alert", alert }); // still usable
      expect(await sensor.next()).toMatchObject({ type: "accepted" });
    },
  );

  test("binary frames get BAD_MESSAGE", async () => {
    const { url } = await startRelay();
    const monitor = await hello(url, "monitor");
    monitor.ws.send(Buffer.from([1, 2, 3]));
    expect(await monitor.next()).toMatchObject({
      type: "error",
      code: "BAD_MESSAGE",
    });
  });

  test("a frame above the size limit closes the connection (1009)", async () => {
    const { url } = await startRelay();
    const sensor = await sensorHello(url);
    sensor.send("x".repeat(17 * 1024));
    expect((await sensor.closed).code).toBe(1009);
  });

  test("a flood is rate limited, then disconnected with 4008", async () => {
    // Frozen clock: the bucket never refills, so the outcome is deterministic.
    const { url } = await startRelay({
      clock: () => 0,
      sensorBucket: { capacity: 2, refillPerSecond: 1 },
    });
    const sensor = await sensorHello(url); // then the sensor bucket starts
    for (let i = 0; i < 110; i++) sensor.send({ type: "alert", alert });

    expect(await sensor.next()).toMatchObject({ type: "accepted" }); // token 1
    expect(await sensor.next()).toMatchObject({
      type: "accepted",
      duplicate: true,
    }); // token 2
    expect(await sensor.next()).toMatchObject({
      type: "error",
      code: "RATE_LIMITED",
    });
    expect((await sensor.closed).code).toBe(4008);
  });

  test("a client that stops answering pings is terminated; a healthy one is not", async () => {
    const { url } = await startRelay({ heartbeatMs: 40 });
    const healthy = await hello(url, "control");
    const dead = await connect(url, { autoPong: false });
    dead.send({ type: "hello", v: 3, role: "control", clientName: "dead" });

    expect((await dead.closed).code).toBe(1006); // terminated, no close frame
    expect(healthy.ws.readyState).toBe(WebSocket.OPEN);
  });

  test("close() says goodbye to every client with 1001", async () => {
    const { url, stop } = await startRelay();
    const monitor = await hello(url, "monitor");
    const control = await hello(url, "control");
    await stop();
    expect((await monitor.closed).code).toBe(1001);
    expect((await control.closed).code).toBe(1001);
  });
});
