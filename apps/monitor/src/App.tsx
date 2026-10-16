import type { ServerMessage, SettingsValue } from "@app/protocol";
import { useRef, useState } from "react";
import { AccountBar } from "./components/AccountBar";
import { AlertLog } from "./components/AlertLog";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { HysteresisControl } from "./components/HysteresisControl";
import { LiveChart } from "./components/LiveChart";
import { ReadoutBar } from "./components/ReadoutBar";
import { SensorPanel } from "./components/SensorPanel";
import { ThresholdForm } from "./components/ThresholdForm";
import { useRelay, type ConnectRelay } from "./connection/useRelay";
import type { ReadingsStore } from "./data/readingsStore";
import { useAppDispatch, useAppSelector } from "./store";
import {
  acknowledged,
  alertReceived,
  selectAlertCounts,
  selectChartMarkers,
  selectLoggedAlerts,
  welcomed,
} from "./store/alertsSlice";
import { sensorChanged } from "./store/sensorSlice";
import { selectDetectorConfig, settingsReceived } from "./store/settingsSlice";

/**
 * Long-lived collaborators, created once in main.tsx (the composition root)
 * and passed in, so nothing with side effects is created during render and
 * tests can substitute fakes.
 */
export type AppProps = {
  connect: ConnectRelay;
  readings: ReadingsStore;
  account: { displayName: string; onLogout: () => void };
};

/**
 * A live view of the sensor (ADR 0009): the readings, the alerts and the
 * shared settings come from the relay. Changing a setting asks the relay,
 * which stores it and tells the sensor and every monitor tab.
 */
export function App({ connect, readings, account }: AppProps) {
  const dispatch = useAppDispatch();
  const [notice, setNotice] = useState<string | null>(null);
  // The last change sent and not yet confirmed. The next change starts from
  // it, so a fast second change does not send the first field's old value.
  const requested = useRef<SettingsValue | null>(null);

  function onMessage(message: ServerMessage) {
    switch (message.type) {
      case "welcome":
        requested.current = null;
        dispatch(welcomed(message.recent));
        dispatch(settingsReceived(message.settings));
        dispatch(sensorChanged(message.sensor));
        readings.reset(message.readings);
        return;
      case "reading":
        readings.push(message.reading);
        return;
      case "alert":
        dispatch(alertReceived(message.record));
        return;
      case "acknowledged":
        dispatch(
          acknowledged({
            alertId: message.alertId,
            operator: message.operator,
            at: message.at,
          }),
        );
        return;
      case "settings":
        if (
          requested.current?.threshold === message.settings.threshold &&
          requested.current.hysteresis === message.settings.hysteresis
        )
          requested.current = null;
        dispatch(settingsReceived(message.settings));
        return;
      case "sensorStatus":
        dispatch(sensorChanged(message.sensor));
        return;
      case "error":
        requested.current = null; // the relay may have refused the change
        setNotice(message.message);
        return;
      case "accepted":
        return; // only the sensor sends alerts
    }
  }

  const { status, send } = useRelay(connect, { onMessage });

  // Only low-frequency state here; live readings are read by the chart and readout.
  const cfg = useAppSelector(selectDetectorConfig);
  const settings = useAppSelector((state) => state.settings.current);
  const sensor = useAppSelector((state) => state.sensor.sensor);
  const counts = useAppSelector(selectAlertCounts);
  const markers = useAppSelector(selectChartMarkers);
  const alerts = useAppSelector(selectLoggedAlerts);

  const canChange = status.kind === "open" && settings !== null;

  function changeSettings(change: Partial<SettingsValue>) {
    setNotice(null);
    const base = requested.current ?? {
      threshold: cfg.threshold,
      hysteresis: cfg.hysteresis,
    };
    const next = { ...base, ...change };
    if (send({ type: "setSettings", settings: next })) requested.current = next;
    else setNotice("Not connected. Try again when the badge shows Connected.");
  }

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Threshold Monitor</h1>
          <p className="muted">
            {sensor ? `${sensor.label} · online` : "Sensor offline"}
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

      <ReadoutBar
        readings={readings}
        threshold={cfg.threshold}
        counts={counts}
      />

      <main className="app__main">
        <section className="panel app__chart" aria-label="Live chart">
          <LiveChart readings={readings} markers={markers} cfg={cfg} />
        </section>
        <section className="panel app__controls" aria-label="Settings">
          <ThresholdForm
            threshold={cfg.threshold}
            disabled={!canChange}
            onCommit={(threshold) => changeSettings({ threshold })}
          />
          <HysteresisControl
            value={cfg.hysteresis}
            disabled={!canChange}
            onChange={(hysteresis) => changeSettings({ hysteresis })}
          />
          <SensorPanel sensor={sensor} settings={settings} />
          {notice && (
            <p className="notice" role="alert">
              {notice}
            </p>
          )}
        </section>
        <AlertLog alerts={alerts} />
      </main>
    </div>
  );
}
