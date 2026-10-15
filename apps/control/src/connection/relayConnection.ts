import {
  encode,
  parseServerMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "@app/protocol";

/**
 * The control room's connection to the relay. The two apps share the protocol
 * package, not their connection code: this file repeats the monitor's small
 * backoff and socket factory on purpose, so neither app depends on the other.
 */

export type ConnectionStatus =
  | { kind: "connecting" }
  | { kind: "open" }
  | { kind: "reconnecting"; attempt: number; retryAt: number }
  | { kind: "closed" }
  | { kind: "signedOut" }; // the relay needs a login (close code 4003); no more retries

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

export type RelayHandlers = {
  onStatus: (status: ConnectionStatus) => void;
  /** Every valid server message, `welcome` included. */
  onMessage: (message: ServerMessage) => void;
};

export type RelayConnection = {
  /** Returns false when there is no welcomed connection to send on. */
  send(message: ClientMessage): boolean;
  dispose(): void;
};

export type RelayOptions = {
  url: string;
  clientName: string;
  createSocket?: SocketFactory;
  clock?: () => number;
  random?: () => number;
  log?: (message: string, detail?: unknown) => void;
};

/** The server closes with this code for an unknown protocol version. Retrying cannot help. */
export const CLOSE_UNSUPPORTED_VERSION = 4002;
/** No session, a session without the operator role, or a logout. A retry cannot help. */
export const CLOSE_UNAUTHORIZED = 4003;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

/** Same formula as the monitor (ADR 0004): capped exponential growth, equal jitter. */
export function backoffDelay(attempt: number, random: () => number): number {
  const exponent = Math.min(Math.max(attempt, 0), 16);
  const capped = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** exponent);
  return capped * (0.5 + random() * 0.5);
}

/** The relay is always at /ws on the page's own host (Vite proxies it in dev). */
export function relayUrl(location: { protocol: string; host: string }): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws`;
}

export const browserSocket: SocketFactory = (url, events) => {
  const ws = new WebSocket(url);
  ws.onopen = () => events.open();
  ws.onmessage = (event) =>
    events.message(typeof event.data === "string" ? event.data : "");
  ws.onclose = (event) => events.close(event.code);
  return {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
  };
};

export function createRelayConnection(
  {
    url,
    clientName,
    createSocket = browserSocket,
    clock = Date.now,
    random = Math.random,
    log = (message, detail) => console.warn(message, detail),
  }: RelayOptions,
  { onStatus, onMessage }: RelayHandlers,
): RelayConnection {
  let socket: RelaySocket | null = null;
  let welcomed = false;
  let attempt = 0;
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    retryTimer = null;
    onStatus({ kind: "connecting" });
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
              role: "control",
              clientName,
            }),
          );
        },
        message(data) {
          if (isCurrent()) receive(data);
        },
        close(code) {
          if (isCurrent()) onClose(code);
        },
      });
      socket = current;
    } catch (err) {
      log("websocket could not be created", err);
      scheduleRetry();
    }
  }

  function receive(data: string) {
    const parsed = parseServerMessage(data);
    if (!parsed.ok) {
      log("invalid message from relay ignored", parsed.error);
      return;
    }
    if (parsed.value.type === "welcome") {
      welcomed = true;
      attempt = 0;
      onStatus({ kind: "open" });
    }
    onMessage(parsed.value);
  }

  function onClose(code: number) {
    socket = null;
    welcomed = false;
    if (code === CLOSE_UNSUPPORTED_VERSION) {
      log("relay speaks another protocol version; not reconnecting");
      onStatus({ kind: "closed" });
      return;
    }
    if (code === CLOSE_UNAUTHORIZED) {
      log("relay needs a login; not reconnecting");
      onStatus({ kind: "signedOut" });
      return;
    }
    scheduleRetry();
  }

  function scheduleRetry() {
    const delay = backoffDelay(attempt, random);
    attempt += 1;
    onStatus({ kind: "reconnecting", attempt, retryAt: clock() + delay });
    retryTimer = setTimeout(connect, delay);
  }

  connect();

  return {
    send(message) {
      if (!socket || !welcomed) return false;
      socket.send(encode(message));
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      const closing = socket;
      socket = null; // its close event is now ignored
      closing?.close(1000, "Control room closed");
      onStatus({ kind: "closed" });
    },
  };
}
