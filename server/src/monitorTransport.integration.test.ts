import type { Alert, ServerMessage } from "@app/protocol";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import type { DeliveryUpdate } from "../../apps/monitor/src/transport/AlertTransport";
import { createWebSocketTransport } from "../../apps/monitor/src/transport/websocketTransport";
import { createMemoryAlertStore } from "./alertStore";
import { silentLogger } from "./logger";
import { attachRelay } from "./relay";

// The monitor's real WebSocket transport (Node's built-in WebSocket) against
// the real relay, with real timers. The fake-socket contract suite lives in
// apps/monitor; this test checks that both sides agree on the wire.

const SOURCE_ID = "8b2e4d71-0c3f-4a59-b6e8-5d1a9f7c3b02";

function alert(n: number): Alert {
  return {
    id: `3f0c6a8e-6b1d-4c2a-9f4e-${n.toString().padStart(12, "0")}`,
    sourceId: SOURCE_ID,
    sourceLabel: "Monitor 8B2",
    metric: "temperature",
    unit: "°C",
    threshold: 25,
    hysteresis: 0.6,
    value: 25.4,
    direction: "up",
    eventTime: "2026-10-14T09:30:00.000Z",
  };
}

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** A relay on `port` (0 = any free port) with a fresh in-memory store, like a restarted process. */
async function startRelay(port = 0) {
  const server: Server = createServer();
  const store = createMemoryAlertStore(100);
  const relay = attachRelay(server, {
    config: { mode: "test", allowedOrigins: [] },
    store,
    logger: silentLogger,
    // Node's built-in WebSocket sends no cookies; every socket is Ada.
    authenticate: () => ({
      id: "session-ada",
      userId: 1,
      username: "ada",
      displayName: "Ada",
      roles: ["operator", "monitor"],
    }),
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

test("delivers alerts, survives a relay restart and surfaces acknowledgements", async () => {
  const first = await startRelay();
  const url = `ws://127.0.0.1:${first.port}/ws`;
  const transport = createWebSocketTransport({
    url,
    identity: { sourceId: SOURCE_ID, sourceLabel: "Monitor 8B2" },
    random: () => 0, // shortest backoff: 250 ms, then 500 ms
    log: () => {},
  });
  cleanup.push(() => transport.dispose());
  const updates: DeliveryUpdate[] = [];
  transport.onDelivery((u) => updates.push(u));
  const has = (id: string, status: DeliveryUpdate["status"]) =>
    updates.some((u) => u.alertId === id && u.status === status);

  transport.send(alert(1));
  await waitFor(() => has(alert(1).id, "accepted"));
  expect(first.store.recent(10).map((r) => r.id)).toEqual([alert(1).id]);

  // Restart: the relay says goodbye (1001), the monitor queues while it is down.
  await first.stop();
  transport.send(alert(2));
  const second = await startRelay(first.port);
  await waitFor(() => has(alert(2).id, "accepted"));
  expect(second.store.recent(10).map((r) => r.id)).toEqual([alert(2).id]);

  // A control room acknowledges; the monitor learns who did it.
  const control = new WebSocket(url);
  cleanup.push(() => control.terminate());
  const inbox: ServerMessage[] = [];
  control.on("message", (data) =>
    inbox.push(JSON.parse((data as Buffer).toString("utf8")) as ServerMessage),
  );
  await once(control, "open");
  control.send(
    JSON.stringify({ type: "hello", v: 2, role: "control", clientName: "CR" }),
  );
  await waitFor(() => inbox.some((m) => m.type === "welcome"));
  control.send(JSON.stringify({ type: "ack", alertId: alert(2).id }));
  await waitFor(() => has(alert(2).id, "acknowledged"));
  expect(updates.at(-1)).toMatchObject({
    alertId: alert(2).id,
    status: "acknowledged",
    operator: "Ada",
  });
});
