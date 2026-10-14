import type { Alert } from "@app/protocol";
import type { DataSource, Reading } from "../data/DataSource";
import type {
  AlertTransport,
  ConnectionStatus,
  DeliveryUpdate,
} from "../transport/AlertTransport";

/** Test doubles driven by hand, so tests control exactly when things happen. */

export function testAlert(id: string, overrides: Partial<Alert> = {}): Alert {
  return {
    id,
    sourceId: "source-1",
    sourceLabel: "Monitor TST",
    metric: "temperature",
    unit: "°C",
    threshold: 25,
    hysteresis: 0.6,
    value: 25.5,
    direction: "up",
    eventTime: "2026-10-14T09:30:00.000Z",
    ...overrides,
  };
}

export class FakeSource implements DataSource {
  private readonly listeners = new Set<(reading: Reading) => void>();
  private t = 0;

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Emits readings with one-second spacing. */
  emit(...values: number[]): void {
    for (const value of values) {
      this.t += 1000;
      for (const listener of this.listeners) listener({ t: this.t, value });
    }
  }

  subscribe(listener: (reading: Reading) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  setRate(): void {}
  pause(): void {}
  resume(): void {}
}

export class FakeTransport implements AlertTransport {
  readonly sent: Alert[] = [];
  disposed = false;
  private readonly statusListeners = new Set<(s: ConnectionStatus) => void>();
  private readonly deliveryListeners = new Set<(u: DeliveryUpdate) => void>();

  send(alert: Alert): void {
    this.sent.push(alert);
  }
  onStatus(listener: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener({ kind: "connecting" });
    return () => this.statusListeners.delete(listener);
  }
  onDelivery(listener: (u: DeliveryUpdate) => void): () => void {
    this.deliveryListeners.add(listener);
    return () => this.deliveryListeners.delete(listener);
  }
  dispose(): void {
    this.disposed = true;
  }

  emitStatus(status: ConnectionStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }
  emitDelivery(update: DeliveryUpdate): void {
    for (const listener of this.deliveryListeners) listener(update);
  }
}

/** A working Storage backed by a Map (jsdom's localStorage is shared between tests). */
export function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

/** A storage getter that throws, like localStorage with site data blocked. */
export const blockedStorage = (): Storage => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};

/** A factory that remembers every transport it created. */
export function fakeTransportFactory() {
  const created: FakeTransport[] = [];
  return {
    created,
    create: (): AlertTransport => {
      const transport = new FakeTransport();
      created.push(transport);
      return transport;
    },
    alive: () => created.filter((t) => !t.disposed),
  };
}
