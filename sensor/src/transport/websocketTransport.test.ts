import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { testAlert } from "../test/fakes";
import { FakeRelay, settle, uuid } from "../test/fakeRelay";
import type { ConnectionStatus, DeliveryUpdate } from "./AlertTransport";
import { runTransportContract, SOURCE_ID } from "./transport.contract";
import {
  CLOSE_UNAUTHORIZED,
  CLOSE_UNSUPPORTED_VERSION,
  createWebSocketTransport,
} from "./websocketTransport";

const sensor = { sensorId: SOURCE_ID, label: "Sensor TST", rateHz: 10 };
const token = "test-sensor-token-0123456789";

runTransportContract("websocket transport", (options) =>
  createWebSocketTransport({
    url: "ws://test.local/ws",
    sensor,
    token,
    log: () => {},
    ...options,
  }),
);

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
      sensor,
      token,
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

  test("says hello as the sensor, with its token and info", async () => {
    const { relay } = setup();
    await settle();
    expect(relay.urls).toEqual(["ws://test.local/ws"]);
    expect(relay.hellos).toEqual([
      {
        type: "hello",
        v: 3,
        role: "sensor",
        clientName: "Sensor TST",
        token,
        sensor,
      },
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

  test("ignores records of other sensors in welcome.recent", async () => {
    const relay = new FakeRelay();
    const other = createWebSocketTransport({
      url: "ws://test.local/ws",
      sensor: { ...sensor, sensorId: uuid(2000), label: "Sensor OTH" },
      token,
      createSocket: relay.createSocket,
      log: () => {},
    });
    await settle();
    other.send(testAlert(uuid(1), { sourceId: uuid(2000) }));
    await settle();

    const updates: DeliveryUpdate[] = [];
    const ours = createWebSocketTransport({
      url: "ws://test.local/ws",
      sensor,
      token,
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

  test("a refused token (4003) stops for good with status unauthorized", async () => {
    const { relay, statuses } = setup();
    await settle();
    relay.stop(CLOSE_UNAUTHORIZED);
    relay.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(statuses.at(-1)).toEqual({ kind: "unauthorized" });
    expect(relay.urls).toHaveLength(1);
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

  test("readings are sent only while connected, never queued", async () => {
    const { relay, transport } = setup();
    transport.sendReading({ t: 1, value: 24 }); // before welcome: dropped
    await settle();
    transport.sendReading({ t: 2, value: 24.1 });
    relay.stop();
    await settle();
    transport.sendReading({ t: 3, value: 24.2 }); // offline: dropped
    relay.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(relay.readings.map((r) => r.t)).toEqual([2]);
  });

  test("drain waits until the relay accepts each alert in the outbox", async () => {
    const { relay, transport } = setup();
    relay.stop(); // offline: the alerts wait in the outbox
    await settle();
    transport.send(testAlert(uuid(1), { sourceId: SOURCE_ID }));
    transport.send(testAlert(uuid(2), { sourceId: SOURCE_ID }));
    const drained = transport.drain(5_000);
    relay.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await drained).toBe(0);
    expect(relay.stored().map((r) => r.id)).toEqual([uuid(1), uuid(2)]);
  });

  test("drain gives up after the timeout and reports what is left", async () => {
    const { relay, transport } = setup();
    relay.stop();
    await settle();
    transport.send(testAlert(uuid(1), { sourceId: SOURCE_ID }));
    const drained = transport.drain(3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await drained).toBe(1);
  });

  test("drain resolves at once with an empty outbox", async () => {
    const { transport } = setup();
    await settle();
    expect(await transport.drain(3_000)).toBe(0);
  });

  test("settings: null on a welcome without stored ones, then each change", async () => {
    const { relay, transport } = setup();
    const seen: unknown[] = [];
    transport.onSettings((s) => seen.push(s));
    await settle();
    expect(seen).toEqual([null]);

    transport.reportSettings({ threshold: 25, hysteresis: 0.6 });
    await settle();
    expect(relay.reportedSettings).toEqual([
      { threshold: 25, hysteresis: 0.6 },
    ]);

    const changed = {
      threshold: 22,
      hysteresis: 0.2,
      updatedBy: "Ana",
      at: "2026-10-14T09:31:00.000Z",
    };
    relay.pushSettings(changed);
    await settle();
    expect(seen.at(-1)).toEqual(changed);

    // After a reconnect, the welcome carries the stored settings.
    relay.stop();
    relay.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen.at(-1)).toEqual(changed);
  });

  test("a socket that cannot be created is retried", async () => {
    let calls = 0;
    const relay = new FakeRelay();
    const transport = createWebSocketTransport({
      url: "bad url",
      sensor,
      token,
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
