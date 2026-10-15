import { useEffect, useState } from "react";
import type { ConnectionStatus } from "../connection/relayConnection";

const labels: Record<
  Exclude<ConnectionStatus["kind"], "reconnecting">,
  string
> = {
  open: "Connected",
  connecting: "Connecting…",
  closed: "Disconnected",
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return (
    <p className={`badge badge--${status.kind}`}>
      <span className="badge__dot" aria-hidden="true" />
      {/* The live region only announces state changes, not every countdown second. */}
      <span role="status" aria-live="polite">
        {status.kind === "reconnecting"
          ? `Reconnecting (attempt ${status.attempt})`
          : labels[status.kind]}
      </span>
      {status.kind === "reconnecting" && (
        // Keyed by retryAt so each retry starts a fresh countdown.
        <RetryCountdown key={status.retryAt} retryAt={status.retryAt} />
      )}
    </p>
  );
}

function RetryCountdown({ retryAt }: { retryAt: number }) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  return <span aria-hidden="true"> · retry in {seconds} s</span>;
}
