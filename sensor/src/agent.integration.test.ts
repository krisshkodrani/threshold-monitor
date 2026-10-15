import type { ServerMessage } from "@app/protocol";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test } from "vitest";
import { createMemoryAlertStore } from "../../server/src/alertStore";
import { silentLogger } from "../../server/src/logger";
import { attachRelay } from "../../server/src/relay";
import { createMemorySettingsStore } from "../../server/src/settingsStore";
import { startAgent } from "./agent";
import type { DataSource, Reading } from "./data/DataSource";
import type { DeliveryUpdate } from "./transport/AlertTransport";
import { createWebSocketTransport } from "./transport/websocketTransport";

// The sensor's real transport (Node's built-in WebSocket) and agent against
// the real relay, with real timers. The fake-socket contract suite is in
// transport/; this test checks that both sides agree on the wire.

const TOKEN = "integration-sensor-token-0123";
const SENSOR = {
  sensorId: "5d0a2f6e-1c3b-4e7a-9b8d-2f4e6a8c0b13",
  label: "Sensor 1",
  rateHz: 10,
};

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** A relay on `port` (0 = any) with fresh in-memory stores, like a restarted process. */
async function startRelay(port = 0) {
  const server: Server = createServer();
  const store = createMemoryAlertStore(100);
  const relay = attachRelay(server, {
    config: { mode: "test", allowedOrigins: [] },
    store,
    settings: createMemorySettingsStore(),
    isSensorToken: (token) => token === TOKEN,
    logger: silentLogger,
    // Node's WebSocket sends no cookies; browsers here are always Ada.
    authenticate: () => ({
      id: "session-ada",
      userId: 1,
      username: "ada",
      displayName: "Ada",
      roles: ["operator", "monitor"],
    }),
    isSessionActive: () => true,
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await relay.close();
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  };
  cleanup.push(stop);
  return { port: (server.address() as AddressInfo).port, store, stop };
}

async function waitFor(check: () => boolean, ms = 3_000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A browser stand-in (Node's built-in WebSocket) that collects every message. */
async function browser(url: string, role: "monitor" | "control") {
  const ws = new WebSocket(url);
  cleanup.push(() => ws.close());
  const inbox: ServerMessage[] = [];
  ws.addEventListener("message", (event) =>
    inbox.push(JSON.parse(String(event.data)) as ServerMessage),
  );
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  ws.send(JSON.stringify({ type: "hello", v: 3, role, clientName: role }));
  await waitFor(() => inbox.some((m) => m.type === "welcome"));
  return { ws, inbox };
}

test("readings, alerts, settings and acknowledgements flow end to end, also across a relay restart", async () => {
  const first = await startRelay();
  const url = `ws://127.0.0.1:${first.port}/ws`;

  const listeners = new Set<(r: Reading) => void>();
  let t = 1_791_000_000_000;
  const source: DataSource = {
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setRate() {},
    pause() {},
    resume() {},
  };
  const emit = (value: number) => {
    t += 100;
    for (const l of listeners) l({ t, value });
  };

  const transport = createWebSocketTransport({
    url,
    sensor: SENSOR,
    token: TOKEN,
    random: () => 0, // shortest backoff
    log: () => {},
  });
  cleanup.push(() => transport.dispose());
  const updates: DeliveryUpdate[] = [];
  transport.onDelivery((u) => updates.push(u));
  const has = (id: string, status: DeliveryUpdate["status"]) =>
    updates.some((u) => u.alertId === id && u.status === status);
  let n = 0;
  const agent = startAgent({
    source,
    transport,
    sensor: SENSOR,
    metric: { key: "temperature", unit: "°C" },
    defaults: { threshold: 25, hysteresis: 0.6 },
    newId: () => `3f0c6a8e-6b1d-4c2a-9f4e-${String(++n).padStart(12, "0")}`,
  });
  cleanup.push(() => agent.stop());

  const monitor = await browser(url, "monitor");
  await waitFor(() =>
    monitor.inbox.some(
      (m) =>
        m.type === "sensorStatus" ||
        (m.type === "welcome" && m.sensor !== null),
    ),
  );

  // A reading reaches the monitor; a crossing becomes a stored alert.
  emit(24);
  await waitFor(() => monitor.inbox.some((m) => m.type === "reading"));
  emit(25.5);
  const firstId = "3f0c6a8e-6b1d-4c2a-9f4e-000000000001";
  await waitFor(() => has(firstId, "accepted"));
  expect(first.store.has(firstId)).toBe(true);

  // A monitor changes the settings; the sensor uses them for the next readings.
  monitor.ws.send(
    JSON.stringify({
      type: "setSettings",
      settings: { threshold: 20, hysteresis: 0.2 },
    }),
  );
  await waitFor(() => agent.settings().threshold === 20);

  // Restart: alerts made while the relay is down wait in the outbox.
  await first.stop();
  emit(19); // below 20 - 0.1: a crossing while offline
  const secondId = "3f0c6a8e-6b1d-4c2a-9f4e-000000000002";
  const second = await startRelay(first.port);
  await waitFor(() => has(secondId, "accepted"), 5_000);
  expect(second.store.has(secondId)).toBe(true);

  // An operator acknowledges; the sensor learns who did it.
  const control = await browser(url, "control");
  control.ws.send(JSON.stringify({ type: "ack", alertId: secondId }));
  await waitFor(() => has(secondId, "acknowledged"));
  expect(updates.at(-1)).toMatchObject({
    status: "acknowledged",
    operator: "Ada",
  });
});
