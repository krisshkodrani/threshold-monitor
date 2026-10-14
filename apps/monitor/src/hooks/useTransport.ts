import { useEffect, useRef, type RefObject } from "react";
import { deliveryUpdated } from "../store/alertsSlice";
import { statusChanged } from "../store/connectionSlice";
import { useAppDispatch } from "../store";
import type { AlertTransport } from "../transport/AlertTransport";

/**
 * Owns the transport's lifetime: one instance per mount, disposed on unmount.
 * Created inside the effect (never during render), so under StrictMode's
 * mount -> unmount -> mount the first transport is disposed before the second
 * exists: at most one connection at any time.
 *
 * Returns a ref rather than state: the transport is only used from event
 * callbacks, and setting state inside an effect would cost an extra render.
 * `createTransport` must be stable (defined once at the composition root).
 */
export function useTransport(
  createTransport: () => AlertTransport,
): RefObject<AlertTransport | null> {
  const dispatch = useAppDispatch();
  const transportRef = useRef<AlertTransport | null>(null);

  useEffect(() => {
    const transport = createTransport();
    transportRef.current = transport;
    const offStatus = transport.onStatus((status) =>
      dispatch(statusChanged(status)),
    );
    const offDelivery = transport.onDelivery((update) =>
      dispatch(deliveryUpdated(update)),
    );

    return () => {
      offStatus();
      offDelivery();
      transport.dispose();
      transportRef.current = null;
    };
  }, [createTransport, dispatch]);

  return transportRef;
}
