export const nodes = {
  sensor: {
    label: "Sensor service",
    eyebrow: "Detection at the source",
    description:
      "A standalone Node process produces simulated temperatures and detects crossings. Its in-memory outbox retries retained alerts, while readings are sent without replay.",
    files: [
      "sensor/src/index.ts",
      "sensor/src/agent.ts",
      "sensor/src/domain/crossing.ts",
      "sensor/src/transport/outbox.ts",
    ],
    tags: ["hello", "reading", "alert", "settingsApplied"],
    code: "agent",
  },
  relay: {
    label: "Relay server",
    eyebrow: "The shared meeting point",
    description:
      "Authenticates connections, validates message schemas and sender roles, persists alerts and settings, and routes updates. Detection stays in the sensor.",
    files: [
      "server/src/relay.ts",
      "server/src/routing.ts",
      "server/src/http.ts",
      "server/src/index.ts",
    ],
    tags: ["welcome", "accepted", "acknowledged", "settings", "sensorStatus"],
    code: "routing",
  },
  monitor: {
    label: "Live Monitor",
    eyebrow: "Live signal & shared settings",
    description:
      "A React dashboard with a rolling chart, alert log, and setting controls. Readings bypass Redux; alerts, settings, and sensor information use three slices.",
    files: [
      "apps/monitor/src/App.tsx",
      "apps/monitor/src/data/readingsStore.ts",
      "apps/monitor/src/store/alertsSlice.ts",
    ],
    tags: ["useRelay", "useReadings", "Redux", "Recharts"],
    code: "alerts",
  },
  control: {
    label: "Control Room",
    eyebrow: "The operator workflow",
    description:
      "Shows alarms and lets authorized operators acknowledge them. One reducer merges incoming records, tracks pending acknowledgements, and caps the list at 500.",
    files: [
      "apps/control/src/App.tsx",
      "apps/control/src/state/alarms.ts",
      "apps/control/src/components/AlarmList.tsx",
    ],
    tags: ["ack", "acknowledged", "useReducer"],
    code: "control",
  },
  database: {
    label: "SQLite storage",
    eyebrow: "Durable state, one relay",
    description:
      "Stores users, hashed session tokens, alerts, acknowledgements, and per-sensor settings. Temperature readings and the sensor outbox are not persisted here.",
    files: [
      "server/src/db.ts",
      "server/src/alertStore.ts",
      "server/src/settingsStore.ts",
      "server/src/sessions.ts",
    ],
    tags: ["WAL", "migrations", "first ack wins"],
    code: "database",
  },
};
