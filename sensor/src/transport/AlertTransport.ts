import type {
  Alert,
  ReadingValue,
  SettingsRecord,
  SettingsValue,
} from "@app/protocol";

export type ConnectionStatus =
  | { kind: "connecting" }
  | { kind: "open" }
  | { kind: "reconnecting"; attempt: number; retryAt: number }
  | { kind: "closed" } // disposed or given up; no more retries
  | { kind: "unauthorized" }; // the relay refused the token (close code 4003); no more retries

export type DeliveryUpdate =
  | { alertId: string; status: "queued" }
  | { alertId: string; status: "sent" }
  | { alertId: string; status: "accepted"; receivedAt: string }
  | { alertId: string; status: "acknowledged"; operator: string; at: string }
  | { alertId: string; status: "dropped"; reason: "outbox_full" };

export type DeliveryStatus = DeliveryUpdate["status"];

/**
 * How the sensor talks to the relay. The agent only depends on this
 * interface, so the WebSocket transport and the test fakes are interchangeable.
 */
export interface AlertTransport {
  /** At least once: queued in the outbox until the relay confirms it. */
  send(alert: Alert): void;
  /** At most once: sent only while connected, else dropped (readings are many). */
  sendReading(reading: ReadingValue): void;
  /** Reports the settings the sensor uses, for a relay that has none stored. */
  reportSettings(settings: SettingsValue): void;
  /**
   * The relay's stored settings: on each welcome (null when it has none, so
   * the agent reports its own) and on each change by a monitor.
   */
  onSettings(listener: (settings: SettingsRecord | null) => void): () => void;
  /** Calls the listener with the current status right away, then on every change. */
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  onDelivery(listener: (update: DeliveryUpdate) => void): () => void;
  /**
   * Waits until the relay has accepted each alert in the outbox, or until
   * `timeoutMs` ends. Resolves with the number of alerts not yet accepted.
   * For a clean stop: the outbox is in memory only.
   */
  drain(timeoutMs: number): Promise<number>;
  dispose(): void;
}
