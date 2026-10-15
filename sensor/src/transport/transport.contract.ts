import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { testAlert } from "../test/fakes";
import { FakeRelay, settle, uuid } from "../test/fakeRelay";
import type {
  AlertTransport,
  ConnectionStatus,
  DeliveryUpdate,
} from "./AlertTransport";
import { MAX_DELAY_MS } from "./backoff";
import { ACCEPT_TIMEOUT_MS } from "./outbox";
import type { SocketFactory } from "./websocketTransport";

export const SOURCE_ID = uuid(1000);

export type TransportFactory = (options: {
  createSocket: SocketFactory;
  random: () => number;
  capacity: number;
}) => AlertTransport;

/**
 * What every network transport must do, checked against a fake relay with fake
 * timers (spec §8.4). Real sockets and fake timers do not mix, so the real
 * relay gets its own integration test (agent.integration.test.ts).
 */
export function runTransportContract(
  name: string,
  makeTransport: TransportFactory,
) {
  describe(`${name} (transport contract)`, () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.parse("2026-10-14T09:30:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function setup({
      random = () => 0.5,
      capacity = 50,
    }: { random?: () => number; capacity?: number } = {}) {
      const relay = new FakeRelay();
      const transport = makeTransport({
        createSocket: relay.createSocket,
        random,
        capacity,
      });
      const statuses: ConnectionStatus[] = [];
      const updates: DeliveryUpdate[] = [];
      const retryDelays: number[] = [];
      transport.onStatus((s) => {
        statuses.push(s);
        if (s.kind === "reconnecting") retryDelays.push(s.retryAt - Date.now());
      });
      transport.onDelivery((u) => updates.push(u));
      const statusesOf = (id: string) =>
        updates.filter((u) => u.alertId === id).map((u) => u.status);
      return { relay, transport, statuses, updates, retryDelays, statusesOf };
    }

    const alert = (n: number) => testAlert(uuid(n), { sourceId: SOURCE_ID });

    test("delivers an alert: queued, sent, accepted", async () => {
      const { relay, transport, statuses, statusesOf } = setup();
      await settle();
      expect(statuses.map((s) => s.kind)).toEqual(["connecting", "open"]);

      transport.send(alert(1));
      await settle();

      expect(statusesOf(uuid(1))).toEqual(["queued", "sent", "accepted"]);
      expect(relay.stored().map((r) => r.id)).toEqual([uuid(1)]);
    });

    test("queues alerts while offline and sends them in order on reconnect", async () => {
      const { relay, transport, statusesOf } = setup();
      relay.up = false;
      await settle();

      for (const n of [1, 2, 3]) transport.send(alert(n));
      expect(statusesOf(uuid(1))).toEqual(["queued"]);

      relay.start();
      await vi.advanceTimersByTimeAsync(MAX_DELAY_MS);

      expect(relay.stored().map((r) => r.id)).toEqual([
        uuid(1),
        uuid(2),
        uuid(3),
      ]);
      expect(statusesOf(uuid(3))).toEqual(["queued", "sent", "accepted"]);
    });

    test("a lost accepted is resent after the timeout and stored once", async () => {
      const { relay, transport, statusesOf } = setup();
      await settle();
      relay.dropNextAccepted();

      transport.send(alert(1));
      await vi.advanceTimersByTimeAsync(ACCEPT_TIMEOUT_MS - 1);
      expect(statusesOf(uuid(1))).toEqual(["queued", "sent"]);

      await vi.advanceTimersByTimeAsync(1);
      expect(statusesOf(uuid(1))).toEqual([
        "queued",
        "sent",
        "queued",
        "sent",
        "accepted",
      ]);
      expect(relay.alertFrames).toHaveLength(2);
      expect(relay.stored()).toHaveLength(1);
    });

    test("alerts pending at a disconnect are resent after reconnect", async () => {
      const { relay, transport, statusesOf } = setup();
      await settle();
      relay.dropNextAccepted();
      transport.send(alert(1));
      await settle();

      relay.stop();
      relay.start();
      await vi.advanceTimersByTimeAsync(MAX_DELAY_MS);

      expect(statusesOf(uuid(1)).at(-1)).toBe("accepted");
      expect(relay.stored()).toHaveLength(1);
    });

    test("a full outbox drops the oldest alert and reports it", async () => {
      const { relay, transport, statusesOf } = setup({ capacity: 2 });
      relay.up = false;
      await settle();

      for (const n of [1, 2, 3]) transport.send(alert(n));
      expect(statusesOf(uuid(1))).toEqual(["queued", "dropped"]);

      relay.start();
      await vi.advanceTimersByTimeAsync(MAX_DELAY_MS);
      expect(relay.stored().map((r) => r.id)).toEqual([uuid(2), uuid(3)]);
    });

    test("reconnect delays grow, stay within the backoff bounds and cap", async () => {
      for (const [random, factor] of [
        [0, 0.5],
        [1, 1],
      ] as const) {
        const { relay, retryDelays } = setup({ random: () => random });
        relay.up = false;
        await vi.advanceTimersByTimeAsync(10 * MAX_DELAY_MS);

        const delays = retryDelays;
        expect(delays.slice(0, 8)).toEqual(
          [0, 1, 2, 3, 4, 5, 6, 7].map(
            (attempt) => Math.min(MAX_DELAY_MS, 500 * 2 ** attempt) * factor,
          ),
        );
      }
    });

    test("an acknowledgement reaches the sensor", async () => {
      const { relay, transport, updates } = setup();
      await settle();
      transport.send(alert(1));
      await settle();

      relay.acknowledge(uuid(1), "Ada", "2026-10-14T09:31:00.000Z");
      await settle();

      expect(updates.at(-1)).toEqual({
        alertId: uuid(1),
        status: "acknowledged",
        operator: "Ada",
        at: "2026-10-14T09:31:00.000Z",
      });
    });

    test("dispose closes the socket, stops timers and ignores later sends", async () => {
      const { relay, transport, statuses, updates } = setup();
      await settle();
      relay.dropNextAccepted();
      transport.send(alert(1));

      transport.dispose();
      await settle();
      expect(statuses.at(-1)).toEqual({ kind: "closed" });
      expect(relay.openConnections()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);

      const before = updates.length;
      transport.send(alert(2));
      await vi.advanceTimersByTimeAsync(10 * MAX_DELAY_MS);
      expect(updates).toHaveLength(before);
      expect(relay.urls).toHaveLength(1);
    });
  });
}
