import type { Alert } from "@app/protocol";
import type {
  AlertTransport,
  ConnectionStatus,
  DeliveryUpdate,
} from "./AlertTransport";

export type InMemoryTransportOptions = {
  /** Simulated time until the "server" accepts an alert, so the UI shows `sent`. */
  acceptDelayMs?: number;
  clock?: () => number;
};

/**
 * A transport with no network: it "connects" on the next tick and accepts every
 * alert after a short delay. Lets the monitor run and be tested without a server.
 */
export function createInMemoryTransport({
  acceptDelayMs = 150,
  clock = Date.now,
}: InMemoryTransportOptions = {}): AlertTransport {
  const statusListeners = new Set<(status: ConnectionStatus) => void>();
  const deliveryListeners = new Set<(update: DeliveryUpdate) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let status: ConnectionStatus = { kind: "connecting" };

  function later(callback: () => void, ms: number) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, ms);
    timers.add(timer);
  }

  function setStatus(next: ConnectionStatus) {
    status = next;
    for (const listener of statusListeners) listener(next);
  }

  function deliver(update: DeliveryUpdate) {
    for (const listener of deliveryListeners) listener(update);
  }

  later(() => setStatus({ kind: "open" }), 0);

  return {
    send(alert: Alert) {
      if (status.kind === "closed") return;
      deliver({ alertId: alert.id, status: "queued" });
      deliver({ alertId: alert.id, status: "sent" });
      later(() => {
        const receivedAt = new Date(clock()).toISOString();
        deliver({ alertId: alert.id, status: "accepted", receivedAt });
      }, acceptDelayMs);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      listener(status);
      return () => statusListeners.delete(listener);
    },
    onDelivery(listener) {
      deliveryListeners.add(listener);
      return () => deliveryListeners.delete(listener);
    },
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      setStatus({ kind: "closed" });
      statusListeners.clear();
      deliveryListeners.clear();
    },
  };
}
