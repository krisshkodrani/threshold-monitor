import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { testAlert } from "../test/fakes";
import { FakeRelay, settle, uuid } from "../test/fakeRelay";
import type { ConnectionStatus, DeliveryUpdate } from "./AlertTransport";
import { runTransportContract, SOURCE_ID } from "./transport.contract";
import {
  CLOSE_UNSUPPORTED_VERSION,
  createWebSocketTransport,
  relayUrl,
} from "./websocketTransport";

const identity = { sourceId: SOURCE_ID, sourceLabel: "Monitor TST" };

runTransportContract("websocket transport", (options) =>
  createWebSocketTransport({
    url: "ws://test.local/ws",
    identity,
    log: () => {},
    ...options,
  }),
);

test("relayUrl follows the page protocol and host", () => {
  expect(relayUrl({ protocol: "http:", host: "localhost:5173" })).toBe(
    "ws://localhost:5173/ws",
  );
  expect(relayUrl({ protocol: "https:", host: "example.com" })).toBe(
    "wss://example.com/ws",
  );
});

describe("websocket transport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const relay = new FakeRelay();
    const log = vi.fn();
    const transport = createWebSocketTransport({
      url: "ws://test.local/ws",
      identity,
      createSocket: relay.createSocket,
      random: () => 0.5,
      log,
    });
    const statuses: ConnectionStatus[] = [];
    const updates: DeliveryUpdate[] = [];
    transport.onStatus((s) => statuses.push(s));
    transport.onDelivery((u) => updates.push(u));
    return { relay, transport, statuses, updates, log };
  }

  test("says hello as a monitor with the source label", async () => {
    const { relay } = setup();
    await settle();
    expect(relay.urls).toEqual(["ws://test.local/ws"]);
    expect(relay.hellos).toEqual([
      { type: "hello", v: 1, role: "monitor", clientName: "Monitor TST" },
    ]);
  });

  test("sends nothing before the welcome", () => {
    const { relay, transport, updates } = setup();
    transport.send(testAlert(uuid(1), { sourceId: SOURCE_ID }));
    expect(updates.map((u) => u.status)).toEqual(["queued"]);
    expect(relay.alertFrames).toEqual([]);
  });

  test("reconciles welcome.recent: no resend, missed acknowledgements surfaced", async () => {
    const { relay, transport, updates } = setup();
    await settle();
    relay.dropNextAccepted();
    transport.send(testAlert(uuid(1), { sourceId: SOURCE_ID }));
    await settle();

    // Offline: the accept was lost and the operator acknowledged meanwhile.
    relay.stop();
    await settle();
    relay.up = true;
    relay.acknowledge(uuid(1), "Ada", "2026-10-14T09:31:00.000Z");
    relay.dropNextAccepted(); // a resend would go unanswered and stay pending
    await vi.advanceTimersByTimeAsync(1_000);

    expect(relay.alertFrames).toHaveLength(1);
    expect(updates.slice(-2).map((u) => u.status)).toEqual([
      "accepted",
      "acknowledged",
    ]);
  });

  test("ignores records of other monitors in welcome.recent", async () => {
    const relay = new FakeRelay();
    const other = createWebSocketTransport({
      url: "ws://test.local/ws",
      identity: { sourceId: uuid(2000), sourceLabel: "Monitor OTH" },
      createSocket: relay.createSocket,
      log: () => {},
    });
    await settle();
    other.send(testAlert(uuid(1), { sourceId: uuid(2000) }));
    await settle();

    const updates: DeliveryUpdate[] = [];
    const ours = createWebSocketTransport({
      url: "ws://test.local/ws",
      identity,
      createSocket: relay.createSocket,
      log: () => {},
    });
    ours.onDelivery((u) => updates.push(u));
    await settle();

    expect(relay.hellos).toHaveLength(2);
    expect(updates).toEqual([]);
    other.dispose();
    ours.dispose();
  });

  test("the attempt count resets after a welcome", async () => {
    const { relay, statuses } = setup();
    relay.up = false;
    await vi.advanceTimersByTimeAsync(2_000); // attempts 1, 2, 3
    relay.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(statuses.at(-1)).toEqual({ kind: "open" });

    relay.stop();
    await settle();
    expect(statuses.at(-1)).toMatchObject({ kind: "reconnecting", attempt: 1 });
  });

  test("an unsupported version closes for good", async () => {
    const { relay, statuses, log } = setup();
    await settle();
    relay.stop(CLOSE_UNSUPPORTED_VERSION);
    relay.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(statuses.at(-1)).toEqual({ kind: "closed" });
    expect(relay.urls).toHaveLength(1);
    expect(log).toHaveBeenCalled();
  });

  test("invalid server messages are logged and ignored", async () => {
    const { relay, transport, statuses, updates, log } = setup();
    await settle();
    relay.sendRaw("not json");
    relay.sendRaw(JSON.stringify({ type: "accepted", alertId: "nope" }));
    await settle();

    expect(log).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toEqual({ kind: "open" });
    transport.send(testAlert(uuid(1), { sourceId: SOURCE_ID }));
    await settle();
    expect(updates.at(-1)?.status).toBe("accepted");
  });

  test("a socket that cannot be created is retried", async () => {
    let calls = 0;
    const relay = new FakeRelay();
    const transport = createWebSocketTransport({
      url: "bad url",
      identity,
      createSocket: (url, events) => {
        calls += 1;
        if (calls === 1) throw new SyntaxError("invalid URL");
        return relay.createSocket(url, events);
      },
      random: () => 0.5,
      log: () => {},
    });
    const statuses: ConnectionStatus["kind"][] = [];
    transport.onStatus((s) => statuses.push(s.kind));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(statuses.at(-1)).toBe("open");
    transport.dispose();
  });
});
