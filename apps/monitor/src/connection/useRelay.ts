import type { ClientMessage, ServerMessage } from "@app/protocol";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import type {
  ConnectionStatus,
  RelayConnection,
  RelayHandlers,
} from "./relayConnection";

export type ConnectRelay = (handlers: RelayHandlers) => RelayConnection;

/**
 * Owns the connection's lifetime: one per mount, created in the effect and
 * disposed on unmount, so StrictMode never has two connections alive.
 * `connect` must be stable (defined once at the composition root).
 * The handlers are read through useEffectEvent: always the latest, no reconnect.
 */
export function useRelay(
  connect: ConnectRelay,
  handlers: {
    onMessage: (message: ServerMessage) => void;
    onStatus?: (status: ConnectionStatus) => void;
  },
) {
  const [status, setStatus] = useState<ConnectionStatus>({
    kind: "connecting",
  });
  const connection = useRef<RelayConnection | null>(null);
  const handleMessage = useEffectEvent(handlers.onMessage);
  const handleStatus = useEffectEvent((next: ConnectionStatus) => {
    setStatus(next);
    handlers.onStatus?.(next);
  });

  useEffect(() => {
    const current = connect({
      onStatus: (next) => handleStatus(next),
      onMessage: (message) => handleMessage(message),
    });
    connection.current = current;
    return () => {
      connection.current = null;
      current.dispose();
    };
  }, [connect]);

  const send = useCallback(
    (message: ClientMessage) => connection.current?.send(message) ?? false,
    [],
  );

  return { status, send };
}
