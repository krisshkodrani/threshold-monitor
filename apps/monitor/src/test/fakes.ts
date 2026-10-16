import type {
  AlertRecord,
  ClientMessage,
  ReadingValue,
  SensorInfo,
  ServerMessage,
  SettingsRecord,
} from "@app/protocol";
import type {
  ConnectionStatus,
  ConnectRelay,
  RelayConnection,
  RelayHandlers,
} from "@app/client";

/** Test doubles driven by hand, so tests control exactly when things happen. */

/** A valid UUID v4 per number. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export function record(
  n: number,
  overrides: Partial<AlertRecord> = {},
): AlertRecord {
  const second = String(n % 60).padStart(2, "0");
  return {
    id: uuid(n),
    sourceId: uuid(1000),
    sourceLabel: "Sensor TST",
    metric: "temperature",
    unit: "°C",
    threshold: 25,
    hysteresis: 0.6,
    value: 25.42,
    direction: "up",
    eventTime: `2026-10-14T09:30:${second}.000Z`,
    receivedAt: `2026-10-14T09:30:${second}.100Z`,
    acknowledgement: null,
    ...overrides,
  };
}

export class FakeConnection implements RelayConnection {
  readonly sent: ClientMessage[] = [];
  disposed = false;
  private open = false;

  constructor(private readonly handlers: RelayHandlers) {
    handlers.onStatus({ kind: "connecting" });
  }

  /** Simulates the relay's welcome: the connection is open from here. */
  welcome(
    recent: AlertRecord[] = [],
    options: {
      settings?: SettingsRecord;
      sensor?: SensorInfo;
      readings?: ReadingValue[];
    } = {},
  ): void {
    this.open = true;
    this.handlers.onStatus({ kind: "open" });
    this.handlers.onMessage({
      type: "welcome",
      connectionId: uuid(999),
      recent,
      settings: options.settings ?? null,
      sensor: options.sensor ?? null,
      readings: options.readings ?? [],
    });
  }

  receive(message: ServerMessage): void {
    this.handlers.onMessage(message);
  }

  status(status: ConnectionStatus): void {
    this.open = status.kind === "open";
    this.handlers.onStatus(status);
  }

  send(message: ClientMessage): boolean {
    if (!this.open) return false;
    this.sent.push(message);
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.handlers.onStatus({ kind: "closed" });
  }
}

/** A `connect` that remembers every connection it created. */
export function fakeConnect() {
  const created: FakeConnection[] = [];
  const connect: ConnectRelay = (handlers) => {
    const connection = new FakeConnection(handlers);
    created.push(connection);
    return connection;
  };
  return {
    connect,
    created,
    alive: () => created.filter((c) => !c.disposed),
  };
}

export const SENSOR: SensorInfo = {
  sensorId: uuid(1000),
  label: "Sensor TST",
  rateHz: 10,
};

export const SETTINGS: SettingsRecord = {
  threshold: 25,
  hysteresis: 0.6,
  updatedBy: null,
  at: "2026-10-14T09:29:00.000Z",
};
