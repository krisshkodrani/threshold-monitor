import { useState } from "react";
import { AlertLog } from "./components/AlertLog";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { HysteresisControl } from "./components/HysteresisControl";
import { LiveChart } from "./components/LiveChart";
import { PlaybackControls } from "./components/PlaybackControls";
import { ReadoutBar } from "./components/ReadoutBar";
import { ThresholdForm } from "./components/ThresholdForm";
import type { DataSource } from "./data/DataSource";
import type { ReadingsStore } from "./data/readingsStore";
import { useThresholdMonitor } from "./hooks/useThresholdMonitor";
import { useTransport } from "./hooks/useTransport";
import type { SourceIdentity } from "./identity";
import { useAppDispatch, useAppSelector } from "./store";
import {
  selectAlertCounts,
  selectChartMarkers,
  selectLoggedAlerts,
} from "./store/alertsSlice";
import { hysteresisChanged, thresholdCommitted } from "./store/thresholdSlice";
import type { AlertTransport } from "./transport/AlertTransport";

/**
 * Long-lived collaborators, created once in main.tsx (the composition root)
 * and passed in, so nothing with side effects is created during render and
 * tests can substitute fakes.
 */
export type AppProps = {
  source: DataSource;
  readings: ReadingsStore;
  createTransport: () => AlertTransport;
  identity: SourceIdentity;
  initialRateHz: number;
};

export function App({
  source,
  readings,
  createTransport,
  identity,
  initialRateHz,
}: AppProps) {
  const dispatch = useAppDispatch();
  const transportRef = useTransport(createTransport);
  const { side } = useThresholdMonitor({
    source,
    readings,
    transportRef,
    identity,
  });

  // Only low-frequency state here; live readings are read by the chart and readout.
  const cfg = useAppSelector((state) => state.threshold);
  const status = useAppSelector((state) => state.connection.status);
  const counts = useAppSelector(selectAlertCounts);
  const markers = useAppSelector(selectChartMarkers);
  const alerts = useAppSelector(selectLoggedAlerts);

  const [paused, setPaused] = useState(false);
  const [rateHz, setRateHz] = useState(initialRateHz);

  function togglePause() {
    if (paused) source.resume();
    else source.pause();
    setPaused(!paused);
  }

  function changeRate(hz: number) {
    source.setRate(hz);
    setRateHz(hz);
  }

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Threshold Monitor</h1>
          <p className="muted">{identity.sourceLabel}</p>
        </div>
        <ConnectionBadge status={status} />
      </header>

      <ReadoutBar
        readings={readings}
        threshold={cfg.threshold}
        side={side}
        counts={counts}
      />

      <main className="app__main">
        <section className="panel app__chart" aria-label="Live chart">
          <LiveChart readings={readings} markers={markers} cfg={cfg} />
        </section>
        <section className="panel app__controls" aria-label="Settings">
          <ThresholdForm
            threshold={cfg.threshold}
            onCommit={(value) => dispatch(thresholdCommitted(value))}
          />
          <HysteresisControl
            value={cfg.hysteresis}
            onChange={(value) => dispatch(hysteresisChanged(value))}
          />
          <PlaybackControls
            paused={paused}
            rateHz={rateHz}
            onTogglePause={togglePause}
            onRateChange={changeRate}
          />
        </section>
        <AlertLog alerts={alerts} />
      </main>
    </div>
  );
}
