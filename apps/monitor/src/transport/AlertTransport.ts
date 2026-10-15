import type { Alert } from "@app/protocol";

export type ConnectionStatus =
  | { kind: "connecting" }
  | { kind: "open" }
  | { kind: "reconnecting"; attempt: number; retryAt: number }
  | { kind: "closed" } // disposed or given up; no more retries
  | { kind: "signedOut" }; // the relay needs a login (close code 4003); no more retries

export type DeliveryUpdate =
  | { alertId: string; status: "queued" }
  | { alertId: string; status: "sent" }
  | { alertId: string; status: "accepted"; receivedAt: string }
  | { alertId: string; status: "acknowledged"; operator: string; at: string }
  | { alertId: string; status: "dropped"; reason: "outbox_full" };

export type DeliveryStatus = DeliveryUpdate["status"];

/**
 * How alerts leave the monitor. The app only depends on this interface, so the
 * WebSocket transport and the test fakes are interchangeable.
 */
export interface AlertTransport {
  send(alert: Alert): void;
  /** Calls the listener with the current status right away, then on every change. */
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  onDelivery(listener: (update: DeliveryUpdate) => void): () => void;
  dispose(): void;
}
