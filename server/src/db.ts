import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Each entry moves the schema one version up. `PRAGMA user_version` records
 * how many have run, so a migration runs exactly once per database file.
 * Never edit an entry that has shipped; add a new one.
 */
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    roles         TEXT NOT NULL, -- comma separated: operator, monitor
    created_at    TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY, -- SHA-256 of the cookie value; the value itself is never stored
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions (user_id);
  CREATE TABLE alerts (
    id           TEXT PRIMARY KEY,
    record       TEXT NOT NULL, -- the AlertRecord as JSON, without its acknowledgement
    received_at  TEXT NOT NULL,
    ack_operator TEXT,
    ack_user_id  INTEGER REFERENCES users (id) ON DELETE SET NULL,
    ack_at       TEXT
  );
  CREATE INDEX alerts_received ON alerts (received_at);
  `,
  // 2: the shared detection settings of each sensor (ADR 0009).
  `
  CREATE TABLE settings (
    sensor_id  TEXT PRIMARY KEY,
    threshold  REAL NOT NULL,
    hysteresis REAL NOT NULL,
    updated_by TEXT, -- display name; NULL: the sensor's own defaults
    updated_at TEXT NOT NULL
  );
  `,
];

/**
 * Opens (and creates, if needed) the database and brings its schema up to
 * date. `:memory:` gives a private database, which the tests use.
 */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync) {
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  for (let next = version; next < MIGRATIONS.length; next++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[next]!);
      db.exec(`PRAGMA user_version = ${next + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
