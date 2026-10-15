import {
  encode,
  parseServerMessage,
  PROTOCOL_VERSION,
  type Alert,
  type AlertRecord,
} from "@app/protocol";
import type {
  AlertTransport,
  ConnectionStatus,
  DeliveryUpdate,
} from "./AlertTransport";
import { backoffDelay } from "./backoff";
import {
  accept,
  ACCEPT_TIMEOUT_MS,
  createOutbox,
  DEFAULT_CAPACITY,
  enqueue,
  expire,
  nextDeadline,
  requeueAll,
  takeForSend,
  type Outbox,
} from "./outbox";

/** What the transport needs from a socket. Small, so tests can fake it. */
export type RelaySocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type SocketEvents = {
  open(): void;
  message(data: string): void;
  close(code: number): void;
};

export type SocketFactory = (url: string, events: SocketEvents) => RelaySocket;

export type WebSocketTransportOptions = {
  url: string;
  /** `sourceId` reconciles `welcome.recent`; `sourceLabel` is the hello's client name. */
  identity: { sourceId: string; sourceLabel: string };
  createSocket?: SocketFactory;
  clock?: () => number;
  random?: () => number;
  log?: (message: string, detail?: unknown) => void;
  capacity?: number;
  acceptTimeoutMs?: number;
};

/** The server closes with this code for an unknown protocol version. Retrying cannot help. */
export const CLOSE_UNSUPPORTED_VERSION = 4002;
/** No session, a session without the monitor role, or a logout. Retrying cannot help. */
export const CLOSE_UNAUTHORIZED = 4003;

/** The relay is always at /ws on the page's own host (Vite proxies it in dev). */
export function relayUrl(location: { protocol: string; host: string }): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws`;
}

/** The default factory: a browser (or Node 22+) WebSocket. */
export const browserSocket: SocketFactory = (url, events) => {
  const ws = new WebSocket(url);
  ws.onopen = () => events.open();
  ws.onmessage = (event) =>
    // The relay only sends text frames; anything else fails to parse and is logged.
    events.message(typeof event.data === "string" ? event.data : "");
  ws.onclose = (event) => events.close(event.code);
  return {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
  };
};

/**
 * Sends alerts to the relay with at-least-once delivery (ADR 0004).
 *
 * One connection at a time. After `welcome`, the outbox is flushed in order;
 * each alert stays pending until `accepted`. A timeout or a lost connection
 * puts pending alerts back in the queue, and the server dedupes the resends.
 * The outbox logic itself lives in `outbox.ts`; this file only adds the
 * socket, one deadline timer, and reconnects with backoff.
 */
export function createWebSocketTransport({
  url,
  identity,
  createSocket = browserSocket,
  clock = Date.now,
  random = Math.random,
  log = (message, detail) => console.warn(message, detail),
  capacity = DEFAULT_CAPACITY,
  acceptTimeoutMs = ACCEPT_TIMEOUT_MS,
}: WebSocketTransportOptions): AlertTransport {
  const statusListeners = new Set<(status: ConnectionStatus) => void>();
  const deliveryListeners = new Set<(update: DeliveryUpdate) => void>();
  let status: ConnectionStatus = { kind: "connecting" };
  let outbox: Outbox<Alert> = createOutbox(capacity);
  let socket: RelaySocket | null = null;
  let welcomed = false;
  let attempt = 0; // failed connections since the last welcome
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

  function setStatus(next: ConnectionStatus) {
    status = next;
    for (const listener of statusListeners) listener(next);
  }

  function deliver(update: DeliveryUpdate) {
    for (const listener of deliveryListeners) listener(update);
  }

  function reportDropped(dropped: Alert[]) {
    for (const alert of dropped)
      deliver({ alertId: alert.id, status: "dropped", reason: "outbox_full" });
  }

  function connect() {
    retryTimer = null;
    setStatus({ kind: "connecting" });
    // Each socket gets its own handlers; events from an old socket are ignored.
    let current: RelaySocket | null = null;
    const isCurrent = () => current !== null && current === socket;
    try {
      current = createSocket(url, {
        open() {
          if (!isCurrent()) return;
          current?.send(
            encode({
              type: "hello",
              v: PROTOCOL_VERSION,
              role: "monitor",
              clientName: identity.sourceLabel,
            }),
          );
        },
        message(data) {
          if (isCurrent()) onMessage(data);
        },
        close(code) {
          if (isCurrent()) onClose(code);
        },
      });
      socket = current;
    } catch (err) {
      // An invalid URL throws synchronously; treat it like a failed connection.
      log("websocket could not be created", err);
      scheduleRetry();
    }
  }

  function onMessage(data: string) {
    const parsed = parseServerMessage(data);
    if (!parsed.ok) {
      log("invalid message from relay ignored", parsed.error);
      return;
    }
    const message = parsed.value;
    switch (message.type) {
      case "welcome":
        welcomed = true;
        attempt = 0;
        setStatus({ kind: "open" });
        reconcile(message.recent);
        flush();
        return;
      case "accepted":
        outbox = accept(outbox, message.alertId);
        deliver({
          alertId: message.alertId,
          status: "accepted",
          receivedAt: message.receivedAt,
        });
        armDeadline();
        return;
      case "acknowledged":
        // Sent to every client; the store ignores ids that are not ours.
        deliver({
          alertId: message.alertId,
          status: "acknowledged",
          operator: message.operator,
          at: message.at,
        });
        return;
      case "error":
        // A rejected alert stays pending and is resent after its timeout.
        log("relay error", message);
        return;
      case "alert":
        return; // only control rooms act on new alerts
    }
  }

  /**
   * The server may already hold alerts whose `accepted` never arrived here,
   * and acknowledgements made while this tab was offline. `recent` carries both.
   */
  function reconcile(recent: AlertRecord[]) {
    for (const record of recent) {
      if (record.sourceId !== identity.sourceId) continue;
      outbox = accept(outbox, record.id);
      deliver({
        alertId: record.id,
        status: "accepted",
        receivedAt: record.receivedAt,
      });
      if (record.acknowledgement) {
        deliver({
          alertId: record.id,
          status: "acknowledged",
          operator: record.acknowledgement.operator,
          at: record.acknowledgement.at,
        });
      }
    }
  }

  function flush() {
    if (!socket || !welcomed) return;
    const taken = takeForSend(outbox, clock(), acceptTimeoutMs);
    outbox = taken.state;
    for (const alert of taken.toSend) {
      deliver({ alertId: alert.id, status: "sent" });
      socket.send(encode({ type: "alert", alert }));
    }
    armDeadline();
  }

  /** One timer for the earliest pending deadline, re-armed whenever pending changes. */
  function armDeadline() {
    if (deadlineTimer !== null) clearTimeout(deadlineTimer);
    deadlineTimer = null;
    const deadline = nextDeadline(outbox);
    if (deadline === null) return;
    deadlineTimer = setTimeout(onDeadline, Math.max(0, deadline - clock()));
  }

  function onDeadline() {
    deadlineTimer = null;
    const result = expire(outbox, clock());
    outbox = result.state;
    for (const alert of result.expired)
      deliver({ alertId: alert.id, status: "queued" });
    reportDropped(result.dropped);
    flush(); // resend now, same ids; the server dedupes
    armDeadline();
  }

  function onClose(code: number) {
    socket = null;
    welcomed = false;
    const pending = outbox.pending.map((entry) => entry.item);
    const result = requeueAll(outbox);
    outbox = result.state;
    for (const alert of pending)
      deliver({ alertId: alert.id, status: "queued" });
    reportDropped(result.dropped);
    armDeadline();

    if (code === CLOSE_UNSUPPORTED_VERSION) {
      log("relay speaks another protocol version; not reconnecting");
      setStatus({ kind: "closed" });
      return;
    }
    if (code === CLOSE_UNAUTHORIZED) {
      log("relay needs a login; not reconnecting");
      setStatus({ kind: "signedOut" });
      return;
    }
    scheduleRetry();
  }

  function scheduleRetry() {
    const delay = backoffDelay(attempt, random);
    attempt += 1;
    setStatus({ kind: "reconnecting", attempt, retryAt: clock() + delay });
    retryTimer = setTimeout(connect, delay);
  }

  connect();

  return {
    send(alert) {
      if (disposed) return;
      const result = enqueue(outbox, alert);
      outbox = result.state;
      deliver({ alertId: alert.id, status: "queued" });
      reportDropped(result.dropped);
      flush();
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
      if (disposed) return;
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
      const closing = socket;
      socket = null; // its close event is now ignored
      closing?.close(1000, "Monitor closed");
      setStatus({ kind: "closed" });
      statusListeners.clear();
      deliveryListeners.clear();
    },
  };
}
