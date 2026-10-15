import type { ServerMessage } from "@app/protocol";
import { useId, useReducer, useState } from "react";
import { AccountBar } from "./components/AccountBar";
import { AlarmList } from "./components/AlarmList";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { useRelay, type ConnectRelay } from "./connection/useRelay";
import {
  alarmsReducer,
  initialAlarmsState,
  unacknowledgedCount,
} from "./state/alarms";

/**
 * Long-lived collaborators come from main.tsx (the composition root), so
 * nothing with side effects is created during render and tests use fakes.
 */
export type AppProps = {
  connect: ConnectRelay;
  /** The signed-in operator. The relay records this name with each acknowledgement. */
  account: { displayName: string; onLogout: () => void };
};

export function App({ connect, account }: AppProps) {
  const [state, dispatch] = useReducer(alarmsReducer, initialAlarmsState);
  const [unacknowledgedOnly, setUnacknowledgedOnly] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const headingId = useId();
  const filterId = useId();

  function onMessage(message: ServerMessage) {
    switch (message.type) {
      case "welcome":
        dispatch({ type: "welcomed", recent: message.recent });
        return;
      case "alert":
        dispatch({ type: "alertReceived", record: message.record });
        return;
      case "acknowledged":
        dispatch({
          type: "acknowledged",
          alertId: message.alertId,
          operator: message.operator,
          at: message.at,
        });
        return;
      case "error":
        // Errors about an ack carry its alert id in `ref`.
        if (message.ref) dispatch({ type: "ackFailed", alertId: message.ref });
        setNotice(message.message);
        return;
      case "accepted":
        return; // only monitors send alerts
    }
  }

  const { status, send } = useRelay(connect, {
    onMessage,
    // An ack in flight when the connection drops may be lost; let the operator retry.
    onStatus: (next) => {
      if (next.kind !== "open") dispatch({ type: "disconnected" });
    },
  });

  function acknowledge(alertId: string) {
    setNotice(null);
    if (send({ type: "ack", alertId })) {
      dispatch({ type: "ackSent", alertId });
    } else {
      setNotice("Not connected. Try again when the badge shows Connected.");
    }
  }

  const open = unacknowledgedCount(state);
  const shown = unacknowledgedOnly
    ? state.alarms.filter((alarm) => !alarm.acknowledgement)
    : state.alarms;

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Control Room</h1>
          <p className="muted">
            <span className="num">{open}</span> unacknowledged
          </p>
        </div>
        <div className="app__status">
          <AccountBar
            displayName={account.displayName}
            onLogout={account.onLogout}
          />
          <ConnectionBadge status={status} />
        </div>
      </header>

      <section className="panel alarms" aria-labelledby={headingId}>
        <div className="panel__header">
          <h2 id={headingId}>
            Alarms{" "}
            {state.alarms.length > 0 && (
              <span className="heading__count">
                · <span className="num">{state.alarms.length}</span> in total
              </span>
            )}
          </h2>
          <div className="panel__tools">
            <label htmlFor={filterId} className="check">
              <input
                id={filterId}
                type="checkbox"
                checked={unacknowledgedOnly}
                onChange={(event) =>
                  setUnacknowledgedOnly(event.target.checked)
                }
              />
              Unacknowledged only
            </label>
            <button
              type="button"
              className="button--quiet"
              disabled={state.alarms.length === open}
              onClick={() => dispatch({ type: "cleared" })}
            >
              Clear acknowledged
            </button>
          </div>
        </div>
        {notice && (
          <p className="notice" role="alert">
            {notice}
          </p>
        )}
        <AlarmList
          alarms={shown}
          pendingAcks={state.pendingAcks}
          canAcknowledge={status.kind === "open"}
          onAcknowledge={acknowledge}
        />
      </section>
    </div>
  );
}
