import { simDecision } from "./decision";
import { produce } from "immer";
import type { SimulationState, SimulationAction, Sample } from "./types";
import { newSimulation, SIM_SENSOR, simulationSettingsChanges } from "./model";
import { simId } from "./format";
import { simulatorStep } from "./detector";
// Simulation snapshots and log payloads contain JSON data only. Serializing also
// unwraps drafts nested inside newly created log envelopes.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const simulationFinished = (state: SimulationState) =>
  state.index >= state.config.readings.length &&
  state.phase === 0 &&
  state.ack === null;
export function simulationReducer(
  state: SimulationState,
  action: SimulationAction,
): SimulationState {
  if (action.type === "RESTART")
    return {
      ...newSimulation(action.config),
      scenario: action.scenario ?? null,
    };
  if (action.type === "RESTORE") return clone(action.state);
  return produce(state, (simulation) => {
    function simTime() {
      return new Date(simulation.clock).toISOString();
    }
    function simLog(title: string, payload: unknown) {
      simulation.events.push({
        number: simulation.events.length + 1,
        time: simTime(),
        sample: simulation.current?.number ?? 0,
        title,
        payload: clone(payload),
      });
    }
    function simulationFinished() {
      return (
        simulation.index >= simulation.config.readings.length &&
        simulation.phase === 0 &&
        simulation.ack === null
      );
    }
    function advanceSimulation() {
      if (simulationFinished()) return false;
      if (!simulation.started) {
        simulation.started = true;
      }
      simulation.clock += 1000;
      if (simulation.ack) {
        const ack = simulation.ack;
        if (ack.phase === 1) {
          simulation.active = "relay";
          const stored = simulation.relayAlerts.find(
            (record) => record.id === ack.id,
          )!;
          if (!stored.acknowledgement)
            stored.acknowledgement = { operator: "Alex", at: simTime() };
          ack.record = clone(stored);
          ack.phase = 2;
          simulation.messageJourney!.phase = 2;
          simulation.status = "Acknowledgement · 2 / 4";
          simulation.title = `${simId(ack.id)} acknowledged in the relay store`;
          simulation.reason =
            "The relay takes Alex’s identity from the simulated authenticated session. A conditional database update records the first acknowledgement. Browser copies have not received the confirmation yet.";
          simLog("Relay → SQLite · first acknowledgement wins", {
            alertId: ack.id,
            ack_user_id: 1,
            acknowledgement: stored.acknowledgement,
          });
        } else if (ack.phase === 2) {
          simulation.active = "views";
          ack.phase = 3;
          simulation.messageJourney!.phase = 3;
          simulation.status = "Acknowledgement · 3 / 4";
          simulation.title = `Relay sends confirmation of ${simId(ack.id)} to all clients`;
          simulation.reason =
            "The stored acknowledgement travels back to the Monitor and control room, and also to the sensor. The alarm stays pending until the browser receives the confirmation.";
          simLog("Relay → clients · acknowledged", {
            type: "acknowledged",
            alertId: ack.id,
            ...ack.record!.acknowledgement!,
          });
        } else {
          simulation.active = "views";
          for (const list of [
            simulation.monitorAlerts,
            simulation.controlAlerts,
          ]) {
            const record = list.find((record) => record.id === ack.id);
            if (record && !record.acknowledgement)
              record.acknowledgement = clone(ack.record!.acknowledgement!);
          }
          simLog("Browser apps · apply acknowledged", {
            alertId: ack.id,
            ...ack.record!.acknowledgement!,
          });
          simulation.title = `${simId(ack.id)} shows “Acknowledged by Alex” in both apps`;
          simulation.reason =
            "The relay broadcasts the stored result. The monitor and control room update their own copies; the first acknowledgement is preserved. The acknowledgement journey is complete.";
          simulation.messageJourney!.phase = 4;
          simulation.ack = null;
          simulation.status = simulationFinished()
            ? "Sequence complete"
            : "Acknowledgement complete · Step to continue";
        }

        return true;
      }
      const change = simulationSettingsChanges[simulation.scenario ?? ""];
      if (
        change &&
        simulation.index === 2 &&
        !simulation.settingsChanged &&
        simulation.phase === 0
      ) {
        const phase = ++simulation.settingsPhase;
        const settings = change.settings;
        simulation.messageJourney = { kind: "settings", phase };
        simulation.status = `Configure alarm · ${phase} / 3`;
        if (phase === 1) {
          simulation.active = "monitor";
          simulation.title = change.requestTitle;
          simulation.reason = `Alex requests threshold ${settings.threshold}°C and hysteresis ${settings.hysteresis}°C in the Monitor. This setSettings request is separate from readings and alarms.`;
          simLog("Monitor → relay · setSettings", {
            type: "setSettings",
            settings,
          });
        } else if (phase === 2) {
          simulation.active = "relay";
          simulation.title =
            "Relay stores the configuration and distributes it";
          simulation.reason =
            "The relay identifies Alex from the authenticated session, persists the shared settings, and sends settings to the sensor and all Monitors. The control room does not configure thresholds.";
          const record = { ...settings, updatedBy: "Alex", at: simTime() };
          simLog("Relay → SQLite · store settings", record);
          simLog("Relay → sensor and monitors · settings", {
            type: "settings",
            settings: record,
          });
        } else {
          simulation.active = "sensor";
          simulation.config = { ...simulation.config, ...settings };
          simulation.settingsChanged = true;
          simulation.reclassifyOnReading = true;
          simulation.title = "Sensor receives settings; no alert is created";
          simulation.reason = change.receivedReason;
          simLog("Sensor · receive settings", settings);
        }

        return true;
      }
      const config = simulation.config;
      simulation.messageJourney = { kind: "reading" };
      if (simulation.phase === 0) {
        simulation.active = "sensor";
        const value = config.readings[simulation.index]!;
        if (simulation.reclassifyOnReading) {
          simulation.detector = {
            side:
              simulation.current!.value > config.threshold ? "above" : "below",
          };
          simulation.reclassifyOnReading = false;
          simLog("Sensor · silently reclassify after settings", {
            previousValue: simulation.current!.value,
            threshold: config.threshold,
            side: simulation.detector.side,
          });
        }
        simulation.previous = simulation.detector.side;
        const [next, event] = simulatorStep(simulation.detector, value, config);
        simulation.detector = next;
        const sample: Sample = {
          number: simulation.index + 1,
          t: simulation.clock,
          value,
          event,
          alert: null,
        };
        simulation.current = sample;
        simulation.samples.push(sample);
        simLog("Sensor → relay · reading", {
          type: "reading",
          reading: { t: sample.t, value },
        });
        simulation.reason = simDecision(
          simulation,
          simulation.previous,
          value,
          config,
          event,
        );
        simLog(
          "Detector · " +
            (event ? `${event.direction} crossing` : "no crossing"),
          {
            before: simulation.previous,
            value,
            settings: {
              threshold: config.threshold,
              hysteresis: config.hysteresis,
            },
            after: next.side,
            event,
          },
        );
        if (event) {
          simulation.alertCount++;
          const id = `00000000-0000-4000-8000-${simulation.alertCount.toString(16).padStart(12, "0")}`;
          sample.alert = {
            id,
            sourceId: SIM_SENSOR,
            sourceLabel: "Sensor 1",
            metric: "temperature",
            unit: "°C",
            value,
            direction: event.direction,
            threshold: config.threshold,
            hysteresis: config.hysteresis,
            eventTime: simTime(),
          };
          simulation.pending.push(sample.alert);
          simLog("Sensor outbox → relay · alert (pending)", {
            type: "alert",
            alert: sample.alert,
          });
        }
        simulation.title = event
          ? `${event.direction === "up" ? "Upward" : "Downward"} crossing → alarm ${simId(sample.alert!.id)}`
          : simulation.previous === null
            ? `Initial state: ${next.side}`
            : "No crossing → reading only";
        simulation.phase = 1;
        simulation.status = `Sample ${sample.number} / ${config.readings.length} · Sensor · 1 / 3`;
      } else if (simulation.phase === 1) {
        simulation.active = "relay";
        const sample = simulation.current!;
        simulation.relayReadings.push({ t: sample.t, value: sample.value });
        simLog("Relay → monitors · reading", {
          type: "reading",
          reading: { t: sample.t, value: sample.value },
        });
        if (sample.alert) {
          const record = {
            ...sample.alert,
            receivedAt: simTime(),
            acknowledgement: null,
          };
          if (!simulation.relayAlerts.some((item) => item.id === record.id))
            simulation.relayAlerts.push(record);
          simulation.pending = simulation.pending.filter(
            (item) => item.id !== record.id,
          );
          simLog("Relay → SQLite · store alert", record);
          simLog("Relay → sensor · accepted", {
            type: "accepted",
            alertId: record.id,
            receivedAt: record.receivedAt,
            duplicate: false,
          });
          simulation.title = `${simId(record.id)} stored; sensor receives accepted`;
          simulation.reason =
            "The relay validates the sender and alert, assigns receivedAt, and stores the record. The sensor removes this ID from its pending outbox. The browser copies update at the next stage.";
        } else {
          simulation.title =
            "Reading buffered and forwarded; no alert to store";
          simulation.reason =
            "The relay keeps a recent reading in memory and forwards it to monitors. It does not run crossing detection or write ordinary readings into the alerts table. The control room receives no reading message.";
        }
        simulation.phase = 2;
        simulation.status = `Sample ${sample.number} / ${config.readings.length} · Relay · 2 / 3`;
      } else {
        simulation.active = "views";
        const sample = simulation.current!;
        simulation.monitorReadings.push({ t: sample.t, value: sample.value });
        if (sample.alert) {
          const record = simulation.relayAlerts.find(
            (item) => item.id === sample.alert!.id,
          )!;
          simulation.monitorAlerts.push(clone(record));
          simulation.controlAlerts.push(clone(record));
          simLog("Relay → monitor + control room · alert", {
            type: "alert",
            record,
          });
          simulation.title = `${simId(record.id)} arrives in both browser apps`;
          simulation.reason =
            "The monitor adds the reading to its external readings store and the alert to Redux. The control room adds the alarm to its reducer. You can now acknowledge it as Alex.";
        } else {
          simulation.title = "Monitor updated; control room unchanged";
          simulation.reason =
            "The monitor’s reading subscribers update the chart and readout. No crossing occurred, so there is no new alarm for either alert list.";
        }
        simLog("Monitor · apply reading", {
          sample: sample.number,
          value: sample.value,
          readoutSide: sample.value > config.threshold ? "above" : "below",
          detectorSide: simulation.detector.side,
        });
        simulation.index++;
        simulation.phase = 0;
        simulation.status = simulationFinished()
          ? "Sequence complete"
          : `Sample ${sample.number} / ${config.readings.length} · Browser apps · 3 / 3`;
      }

      return true;
    }
    function requestSimulationAck(id: string) {
      if (simulation.ack) return;
      const record = simulation.controlAlerts.find(
        (record) => record.id === id,
      );
      if (!record || record.acknowledgement) return;

      simulation.clock += 1000;
      simulation.ack = { id, phase: 1, record: null };
      simulation.messageJourney = { kind: "ack", id, phase: 1 };
      simulation.active = "views";
      simulation.status = "Acknowledgement · 1 / 4";
      simulation.title = `Operator requests acknowledgement of ${simId(id)}`;
      simulation.reason =
        "Alex clicks Acknowledge in the control room. The request contains only the alert ID. The relay will derive the operator identity from the session. Follow the acknowledgement through relay storage and back to both browser apps.";
      simLog("Control room → relay · ack", { type: "ack", alertId: id });
    }

    switch (action.type) {
      case "NEXT_STAGE":
        advanceSimulation();
        break;
      case "REQUEST_ACK":
        requestSimulationAck(action.id);
        break;
    }
  });
}
