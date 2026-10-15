import {
  encode,
  parseClientMessage,
  type Alert,
  type AlertRecord,
  type Hello,
  type ReadingValue,
  type ServerMessage,
  type SettingsRecord,
  type SettingsValue,
} from "@app/protocol";
import { vi } from "vitest";
import type {
  RelaySocket,
  SocketEvents,
  SocketFactory,
} from "../transport/websocketTransport";

type Connection = { events: SocketEvents; open: boolean };

/**
 * An in-process relay behind a fake socket, for tests with fake timers. It
 * follows the real relay's rules (hello first, dedupe by id, `recent` newest
 * first) and every event arrives asynchronously, like on a real network.
 */
export class FakeRelay {
  up = true;
  readonly hellos: Hello[] = [];
  /** Every alert frame received, resends included. */
  readonly alertFrames: Alert[] = [];
  readonly urls: string[] = [];
  readonly readings: ReadingValue[] = [];
  readonly reportedSettings: SettingsValue[] = [];
  /** What the next welcome carries as the stored settings. */
  storedSettings: SettingsRecord | null = null;
  private readonly records = new Map<string, AlertRecord>();
  private readonly connections: Connection[] = [];
  private acceptedToDrop = 0;

  readonly createSocket: SocketFactory = (url, events) => {
    this.urls.push(url);
    const connection: Connection = { events, open: false };
    this.connections.push(connection);
    this.later(() => {
      if (!this.up) return events.close(1006);
      connection.open = true;
      events.open();
    });
    const socket: RelaySocket = {
      send: (data) => this.receive(connection, data),
      close: (code = 1000) => this.closeConnection(connection, code),
    };
    return socket;
  };

  /** Stored alerts in arrival order. */
  stored(): AlertRecord[] {
    return [...this.records.values()];
  }

  openConnections(): number {
    return this.connections.filter((c) => c.open).length;
  }

  /** The next `accepted` reply is lost on the way back. */
  dropNextAccepted(): void {
    this.acceptedToDrop += 1;
  }

  stop(code = 1006): void {
    this.up = false;
    for (const connection of this.connections)
      this.closeConnection(connection, code);
  }

  start(): void {
    this.up = true;
  }

  acknowledge(alertId: string, operator: string, at: string): void {
    const record = this.records.get(alertId);
    if (!record) throw new Error(`unknown alert ${alertId}`);
    record.acknowledgement = { operator, at };
    for (const connection of this.connections)
      this.reply(connection, { type: "acknowledged", alertId, operator, at });
  }

  /** A monitor changed the settings: the relay stores and forwards them. */
  pushSettings(settings: SettingsRecord): void {
    this.storedSettings = settings;
    for (const connection of this.connections)
      this.reply(connection, { type: "settings", settings });
  }

  /** Sends raw text to every open connection, for malformed-input tests. */
  sendRaw(data: string): void {
    for (const connection of this.connections)
      if (connection.open) this.later(() => connection.events.message(data));
  }

  private receive(connection: Connection, data: string) {
    if (!connection.open) throw new Error("send on a closed socket");
    const parsed = parseClientMessage(data);
    if (!parsed.ok) throw new Error(`bad client message: ${data}`);
    const message = parsed.value;
    if (message.type === "hello") {
      this.hellos.push(message);
      const recent = this.stored().reverse();
      this.reply(connection, {
        type: "welcome",
        connectionId: "00000000-0000-4000-8000-0000000000ff",
        recent,
        settings: this.storedSettings,
        sensor: null,
        readings: [],
      });
    } else if (message.type === "reading") {
      this.readings.push(message.reading);
    } else if (message.type === "settingsApplied") {
      this.reportedSettings.push(message.settings);
    } else if (message.type === "alert") {
      this.alertFrames.push(message.alert);
      const existing = this.records.get(message.alert.id);
      const record = existing ?? {
        ...message.alert,
        receivedAt: new Date().toISOString(),
        acknowledgement: null,
      };
      this.records.set(record.id, record);
      if (this.acceptedToDrop > 0) {
        this.acceptedToDrop -= 1;
        return;
      }
      this.reply(connection, {
        type: "accepted",
        alertId: record.id,
        receivedAt: record.receivedAt,
        duplicate: existing !== undefined,
      });
    }
  }

  private reply(connection: Connection, message: ServerMessage) {
    if (connection.open)
      this.later(() => connection.events.message(encode(message)));
  }

  private closeConnection(connection: Connection, code: number) {
    if (!connection.open) return;
    connection.open = false;
    this.later(() => connection.events.close(code));
  }

  // Microtasks, not timers: a round trip takes no fake time, so tests can
  // count deadlines and backoff delays exactly.
  private later(callback: () => void) {
    queueMicrotask(callback);
  }
}

/** A valid UUID v4 per number, so alerts pass the protocol schema. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

/**
 * Lets queued socket events and due timers run without moving the clock: one
 * round trip (open, hello, welcome, flush) is several chained events.
 */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
}
