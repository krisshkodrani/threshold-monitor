import type { Alert, ServerMessage } from "@app/protocol";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { connect as tcpConnect, type AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { createMemoryAlertStore } from "./alertStore";
import { silentLogger } from "./logger";
import { attachRelay, type RelayDeps } from "./relay";

const ORIGIN = "http://test.local";
const ALERT_ID = "3f0c6a8e-6b1d-4c2a-9f4e-2a7d5b9c1e01";

const alert: Alert = {
  id: ALERT_ID,
  sourceId: "8b2e4d71-0c3f-4a59-b6e8-5d1a9f7c3b02",
  sourceLabel: "Monitor 8B2",
  metric: "temperature",
  unit: "°C",
  threshold: 25,
  hysteresis: 0.6,
  value: 25.4,
  direction: "up",
  eventTime: "2026-10-14T09:30:00.000Z",
};

// ---- harness: a real HTTP server with the relay on a random port ----------

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
  options: { origin?: string; autoPong?: boolean } = {},
) {
  const ws = new WebSocket(url, {
    origin: options.origin ?? ORIGIN,
    autoPong: options.autoPong ?? true,
  });
  const inbox: ServerMessage[] = [];
  const waiting: ((m: ServerMessage) => void)[] = [];
  ws.on("message", (data) => {
    const message = JSON.parse(
      (data as Buffer).toString("utf8"),
    ) as ServerMessage;
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
): Promise<TestClient> {
  const client = await connect(url);
  client.send({ type: "hello", v: 1, role, clientName: name });
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
      v: 1,
      role: "monitor",
      clientName: "Monitor A",
    });
    expect(await client.next()).toEqual({
      type: "welcome",
      connectionId: "c4a7e9b2-5f18-4d3c-8a6e-0b9d2f1c7e03",
      recent: [],
    });
  });

  test("any other first message is refused and the socket closed with 4001", async () => {
    const { url } = await startRelay();
    const client = await connect(url);
    client.send({ type: "ack", alertId: ALERT_ID, operator: "Ana" });
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
    client.send({ type: "hello", v: 2, role: "monitor", clientName: "Future" });
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

describe("routing", () => {
  test("an alert is accepted for the monitor and forwarded to every control room", async () => {
    const { url } = await startRelay();
    const controlA = await hello(url, "control", "A");
    const controlB = await hello(url, "control", "B");
    const monitor = await hello(url, "monitor");

    monitor.send({ type: "alert", alert });
    expect(await monitor.next()).toMatchObject({
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
    const monitor = await hello(url, "monitor");

    monitor.send({ type: "alert", alert });
    await monitor.next();
    await control.next();

    monitor.send({ type: "alert", alert });
    expect(await monitor.next()).toMatchObject({
      type: "accepted",
      duplicate: true,
    });
    expect(await control.silentFor(100)).toBe(true);
  });

  test("an acknowledgement reaches the monitor and all control rooms", async () => {
    const { url } = await startRelay();
    const controlA = await hello(url, "control", "A");
    const controlB = await hello(url, "control", "B");
    const monitor = await hello(url, "monitor");
    monitor.send({ type: "alert", alert });
    await monitor.next();
    await controlA.next();
    await controlB.next();

    controlA.send({ type: "ack", alertId: ALERT_ID, operator: "Ana" });
    for (const client of [monitor, controlA, controlB]) {
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
    monitor.send({ type: "ack", alertId: ALERT_ID, operator: "Mallory" });
    expect(await monitor.next()).toMatchObject({
      type: "error",
      code: "NOT_ALLOWED",
    });
  });

  test("acknowledging an unknown alert is reported", async () => {
    const { url } = await startRelay();
    const control = await hello(url, "control");
    control.send({ type: "ack", alertId: ALERT_ID, operator: "Ana" });
    expect(await control.next()).toMatchObject({
      type: "error",
      code: "UNKNOWN_ALERT",
      ref: ALERT_ID,
    });
  });

  test("a client that connects later gets recent alerts in its welcome", async () => {
    const { url } = await startRelay();
    const monitor = await hello(url, "monitor");
    monitor.send({ type: "alert", alert });
    await monitor.next();

    const late = await connect(url);
    late.send({ type: "hello", v: 1, role: "control", clientName: "Late" });
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
      const monitor = await hello(url, "monitor");
      monitor.send(raw);
      expect(await monitor.next()).toMatchObject({
        type: "error",
        code: "BAD_MESSAGE",
      });

      monitor.send({ type: "alert", alert }); // still usable
      expect(await monitor.next()).toMatchObject({ type: "accepted" });
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
    const monitor = await hello(url, "monitor");
    monitor.send("x".repeat(17 * 1024));
    expect((await monitor.closed).code).toBe(1009);
  });

  test("a flood is rate limited, then disconnected with 4008", async () => {
    // Frozen clock: the bucket never refills, so the outcome is deterministic.
    const { url } = await startRelay({
      clock: () => 0,
      bucket: { capacity: 3, refillPerSecond: 1 },
    });
    const monitor = await hello(url, "monitor"); // uses 1 token
    for (let i = 0; i < 110; i++) monitor.send({ type: "alert", alert });

    expect(await monitor.next()).toMatchObject({ type: "accepted" }); // token 2
    expect(await monitor.next()).toMatchObject({
      type: "accepted",
      duplicate: true,
    }); // token 3
    expect(await monitor.next()).toMatchObject({
      type: "error",
      code: "RATE_LIMITED",
    });
    expect((await monitor.closed).code).toBe(4008);
  });

  test("a client that stops answering pings is terminated; a healthy one is not", async () => {
    const { url } = await startRelay({ heartbeatMs: 40 });
    const healthy = await hello(url, "control");
    const dead = await connect(url, { autoPong: false });
    dead.send({ type: "hello", v: 1, role: "control", clientName: "dead" });

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
