import { simulationSettingsChanges } from "./model";
import { simDecision } from "./decision";
import { simId, simTemperature, simNumber } from "./format";
/**
 * @param {import("./types").SimulationState} simulation
 * @returns {import("./types").SimulationMessageModel}
 */
export function simulationMessageModel(simulation) {
  const journey = simulation.messageJourney;
  const isAck = journey?.kind === "ack";
  const stage = isAck
    ? journey.phase
    : !simulation.started
      ? 0
      : simulation.active === "sensor"
        ? 1
        : simulation.active === "relay"
          ? 2
          : 3;
  const rows = [];
  const sample = simulation.current;
  const add = (row) =>
    rows.push({
      ...row,
      state:
        row.stage < stage
          ? "complete"
          : row.stage === stage
            ? "active"
            : "pending",
    });
  const event = (title) =>
    simulation.events.find(
      (e) => e.sample === sample?.number && e.title === title,
    )?.payload ?? null;
  if (journey?.kind === "settings") {
    const stage = journey.phase;
    const settings =
      simulationSettingsChanges[simulation.scenario]?.settings ??
      simulation.config;
    const payload = (title) =>
      [...simulation.events].reverse().find((e) => e.title === title)
        ?.payload ?? null;
    const settingsRows = [
      {
        id: "settings-request",
        from: "monitor",
        to: "relay",
        edge: "monitor-relay",
        name: "setSettings",
        stage: 1,
        transport: "WebSocket · JSON",
        payload: payload("Monitor → relay · setSettings"),
        description: `The Monitor requests threshold ${simTemperature(settings.threshold)} and hysteresis ${simTemperature(settings.hysteresis)}. Operator identity comes from the session.`,
      },
      {
        id: "settings-store",
        from: "relay",
        to: "database",
        edge: "relay-database",
        name: "UPSERT settings",
        stage: 2,
        transport: "Local SQLite operation",
        payload: payload("Relay → SQLite · store settings"),
        description:
          "The relay persists the shared configuration, with operator and time.",
      },
      {
        id: "settings-sensor",
        from: "relay",
        to: "sensor",
        edge: "relay-sensor",
        name: "settings",
        stage: 2,
        transport: "WebSocket · JSON",
        payload: payload("Relay → sensor and monitors · settings"),
        description: "The relay distributes settings to the sensor.",
      },
      {
        id: "settings-monitor",
        from: "relay",
        to: "monitor",
        edge: "relay-monitor",
        name: "settings",
        stage: 2,
        transport: "WebSocket · JSON",
        payload: payload("Relay → sensor and monitors · settings"),
        description: "All Monitors receive the stored configuration.",
      },
      {
        id: "settings-apply",
        from: "sensor",
        to: "sensor",
        edge: null,
        name: "Receive configuration",
        stage: 3,
        transport: "Local agent configuration",
        payload: payload("Sensor · receive settings"),
        description:
          "No alert. The agent silently reclassifies the previous reading before evaluating the next measurement.",
      },
    ].map((row) => ({
      ...row,
      preview: `${simTemperature(simulation.config.threshold)} → ${simTemperature(settings.threshold)} · hysteresis ${simTemperature(settings.hysteresis)}`,
      state:
        row.stage < stage
          ? "complete"
          : row.stage === stage
            ? "active"
            : "pending",
    }));
    return {
      rows: settingsRows,
      stage,
      key: `settings:${stage}`,
      context: "MONITOR CONFIGURES THE SENSOR · NO ALERT FROM CONFIGURATION",
      isAck: false,
      isSettings: true,
    };
  }
  if (isAck) {
    const id = journey.id;
    const ackEvent = (title) =>
      [...simulation.events]
        .reverse()
        .find((e) => e.title === title && e.payload.alertId === id)?.payload ??
      null;
    add({
      id: "ack-request",
      from: "control",
      to: "relay",
      name: "ack",
      preview: `alertId: ${simId(id)}`,
      stage: 1,
      transport: "WebSocket · JSON",
      edge: "control-relay",
      payload: ackEvent("Control room → relay · ack"),
      description:
        "The operator sends only an alert ID. The client does not supply an operator name.",
    });
    add({
      id: "ack-store",
      from: "relay",
      to: "database",
      name: "UPDATE acknowledgement",
      preview: `${simId(id)} · first acknowledgement wins`,
      stage: 2,
      transport: "Local SQLite operation",
      edge: "relay-database",
      payload: ackEvent("Relay → SQLite · first acknowledgement wins"),
      description:
        "The relay obtains Alex’s identity from the session and records the first acknowledgement with a conditional database update.",
    });
    for (const to of ["sensor", "monitor", "control"])
      add({
        id: "ack-" + to,
        from: "relay",
        to,
        name: "acknowledged",
        preview: `${simId(id)} · operator: Alex`,
        stage: 3,
        transport: "WebSocket · JSON",
        edge: "relay-" + to,
        payload: ackEvent("Relay → clients · acknowledged"),
        description:
          to === "sensor"
            ? "The relay broadcasts acknowledgement to all clients, including the sensor. This is separate from accepted, which confirmed alert storage."
            : "The relay sends the stored acknowledgement to this browser. The next manual stage applies it to the browser’s own copy.",
      });
    for (const to of ["monitor", "control"])
      add({
        id: "ack-apply-" + to,
        from: to,
        to,
        name: "Apply acknowledged",
        preview: `${simId(id)} · Acknowledged by Alex`,
        stage: 4,
        transport: "Local browser state update",
        edge: null,
        payload: ackEvent("Browser apps · apply acknowledged"),
        description:
          "The browser applies the confirmed acknowledgement to its own alarm copy and clears its pending request. Sending or broadcasting alone did not update this copy.",
      });
    return {
      rows,
      stage,
      key: `ack:${id}:${stage}`,
      context: `ACKNOWLEDGEMENT · ${simId(id)}`,
      isAck,
    };
  }
  const reading = sample ? { t: sample.t, value: sample.value } : null;
  const n = sample?.number ?? 1;
  add({
    id: "source",
    from: "sensor",
    to: "sensor",
    name: "Read temperature",
    preview: reading
      ? `sample #${n} · ${simTemperature(reading.value)}`
      : "Waiting for the first sample",
    stage: 1,
    transport: "Local data source",
    edge: null,
    payload: reading,
    description:
      "The scheduled data source supplies a timestamped reading to the agent. The current application uses a simulated random walk.",
  });
  add({
    id: "reading-out",
    from: "sensor",
    to: "relay",
    name: "reading",
    preview: reading
      ? `value: ${simNumber(reading.value)}`
      : "timestamp + temperature",
    stage: 1,
    transport: "WebSocket · JSON",
    edge: "sensor-relay",
    payload: event("Sensor → relay · reading"),
    description:
      "The agent sends the reading before crossing detection. The transport sends only after the authenticated connection has received welcome.",
  });
  const detectorPayload =
    simulation.events.find(
      (e) => e.sample === n && e.title.startsWith("Detector ·"),
    )?.payload ?? null;
  add({
    id: "detect",
    from: "sensor",
    to: "sensor",
    name: "Check hysteresis",
    preview: detectorPayload
      ? `${detectorPayload.before ?? "uninitialized"} → ${detectorPayload.after} · ${detectorPayload.event ? detectorPayload.event.direction + " crossing" : "no crossing"}`
      : "Compare against the opposite band edge",
    stage: 1,
    transport: "Local detector function",
    edge: null,
    payload: detectorPayload,
    description: sample
      ? simDecision(
          simulation,
          simulation.previous,
          sample.value,
          simulation.config,
          sample.event,
        )
      : "The first sample initializes the remembered state. Later readings must strictly cross the opposite hysteresis edge to produce an event.",
  });
  if (sample?.alert) {
    add({
      id: "build-alert",
      from: "sensor",
      to: "sensor",
      name: "Generate alert",
      preview: `${simId(sample.alert.id)} · ${sample.event.direction} · ${simTemperature(sample.value)}`,
      stage: 1,
      transport: "Local alert construction",
      edge: null,
      payload: sample.alert,
      description:
        "The agent creates one UUID and attaches sensor identity, crossing direction, value, triggering settings, and event time. Repeated high readings alone do not create repeated alerts.",
    });
    add({
      id: "alert-out",
      from: "sensor",
      to: "relay",
      name: "alert",
      preview: `${simId(sample.alert.id)} · pending accepted`,
      stage: 1,
      transport: "WebSocket · JSON",
      edge: "sensor-relay",
      payload: event("Sensor outbox → relay · alert (pending)"),
      description:
        "The transport sends the alert and tracks its ID as pending until accepted. The sensor has generated it; the relay has not confirmed storage yet.",
    });
  }
  add({
    id: "reading-in",
    from: "relay",
    to: "monitor",
    name: "reading",
    preview: reading
      ? `value: ${simNumber(reading.value)}`
      : "same timestamp + temperature",
    stage: 2,
    transport: "WebSocket · JSON",
    edge: "relay-monitor",
    payload: event("Relay → monitors · reading"),
    description:
      "The relay keeps a recent reading in memory and forwards it to monitors only. The control room does not receive reading messages. Browser application is shown in stage 3.",
  });
  if (sample?.alert) {
    add({
      id: "store-alert",
      from: "relay",
      to: "database",
      name: "INSERT alert",
      preview: `${simId(sample.alert.id)} + receivedAt`,
      stage: 2,
      transport: "Local SQLite operation",
      edge: "relay-database",
      payload: event("Relay → SQLite · store alert"),
      description:
        "The relay validates the sender and source ID, adds receivedAt, and stores a new record. This is a local database operation, not a WebSocket message.",
    });
    add({
      id: "accepted",
      from: "relay",
      to: "sensor",
      name: "accepted",
      preview: `${simId(sample.alert.id)} · duplicate: false`,
      stage: 2,
      transport: "WebSocket · JSON",
      edge: "relay-sensor",
      payload: event("Relay → sensor · accepted"),
      description:
        "This confirms relay storage and removes the sensor’s pending entry. It does not mean a human has acknowledged the alarm.",
    });
    const broadcast = event("Relay → monitor + control room · alert");
    for (const to of ["monitor", "control"])
      add({
        id: "alert-" + to,
        from: "relay",
        to,
        name: "alert",
        preview: `${simId(sample.alert.id)} · stored record`,
        stage: 3,
        transport: "WebSocket · JSON",
        edge: "relay-" + to,
        payload: broadcast,
        description:
          to === "monitor"
            ? "The monitor receives the stored record, including receivedAt and acknowledgement. Its Redux alert slice updates the log, counts, and chart markers."
            : "The control room receives the same record and adds it to its alarm reducer. An operator can now send ack for this ID.",
      });
  }
  add({
    id: "apply-reading",
    from: "monitor",
    to: "monitor",
    name: "Apply reading",
    preview: reading
      ? `${simTemperature(reading.value)} → chart + readout`
      : "external readings store → subscribers",
    stage: 3,
    transport: "Local React state update",
    edge: null,
    payload: event("Monitor · apply reading"),
    description:
      "The external readings store notifies useReadings and useLatestReading. The monitor’s Above / Below label compares directly to the threshold; it is not the detector’s hysteresis state.",
  });
  return {
    rows,
    stage,
    key: `sample:${n}:${stage}`,
    context: `${simulation.started ? "SAMPLE " + n : "READY · SAMPLE 1"} · ${sample?.alert ? simId(sample.alert.id) : "READING"}`,
    isAck,
  };
}
