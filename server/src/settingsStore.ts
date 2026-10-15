import type { SettingsRecord } from "@app/protocol";
import type { DatabaseSync } from "node:sqlite";

/** The shared detection settings of a sensor. The relay stores them; the sensor applies them. */
export type StoredSettings = { sensorId: string; settings: SettingsRecord };

export interface SettingsStore {
  get(sensorId: string): SettingsRecord | undefined;
  /** The most recently changed settings of any sensor (one sensor for now). */
  latest(): StoredSettings | undefined;
  set(sensorId: string, settings: SettingsRecord): void;
}

export function createMemorySettingsStore(): SettingsStore {
  const bySensor = new Map<string, SettingsRecord>();
  let last: StoredSettings | undefined;
  return {
    get: (sensorId) => bySensor.get(sensorId),
    latest: () => last,
    set(sensorId, settings) {
      bySensor.set(sensorId, settings);
      last = { sensorId, settings };
    },
  };
}

type SettingsRow = {
  sensor_id: string;
  threshold: number;
  hysteresis: number;
  updated_by: string | null;
  updated_at: string;
};

export function createSqliteSettingsStore(db: DatabaseSync): SettingsStore {
  const byId = db.prepare("SELECT * FROM settings WHERE sensor_id = ?");
  const newest = db.prepare(
    "SELECT * FROM settings ORDER BY updated_at DESC, rowid DESC LIMIT 1",
  );
  const upsert = db.prepare(
    `INSERT INTO settings (sensor_id, threshold, hysteresis, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (sensor_id) DO UPDATE SET threshold = excluded.threshold,
       hysteresis = excluded.hysteresis, updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  );
  return {
    get(sensorId) {
      const row = byId.get(sensorId) as SettingsRow | undefined;
      return row && toRecord(row);
    },
    latest() {
      const row = newest.get() as SettingsRow | undefined;
      return row && { sensorId: row.sensor_id, settings: toRecord(row) };
    },
    set(sensorId, s) {
      upsert.run(sensorId, s.threshold, s.hysteresis, s.updatedBy, s.at);
    },
  };
}

function toRecord(row: SettingsRow): SettingsRecord {
  return {
    threshold: row.threshold,
    hysteresis: row.hysteresis,
    updatedBy: row.updated_by,
    at: row.updated_at,
  };
}
