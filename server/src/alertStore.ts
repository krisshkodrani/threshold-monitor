import type { AlertRecord } from "@app/protocol";
import type { DatabaseSync } from "node:sqlite";

/**
 * Where the relay keeps alerts. Everything else talks to this interface, so
 * the routing code is the same for the in-memory version (tests) and the
 * SQLite version (the server, ADR 0007).
 */
export interface AlertStore {
  add(record: AlertRecord): void;
  get(id: string): AlertRecord | undefined;
  has(id: string): boolean;
  /**
   * Sets the acknowledgement if none exists yet (first one wins). Undefined if
   * unknown. `userId` is kept for the audit trail where the store supports it.
   */
  acknowledge(
    id: string,
    operator: string,
    at: string,
    userId?: number,
  ): AlertRecord | undefined;
  /** Newest first. */
  recent(limit: number): AlertRecord[];
}

/**
 * Keeps the last `limit` alerts. A Map gives lookup by id; an array of ids
 * remembers insertion order so the oldest can be evicted from both.
 * Records are replaced rather than mutated, so a record handed out earlier
 * never changes underneath its holder.
 */
export function createMemoryAlertStore(limit: number): AlertStore {
  const byId = new Map<string, AlertRecord>();
  const order: string[] = []; // oldest first

  return {
    add(record) {
      if (byId.has(record.id)) return; // ids are idempotency keys
      byId.set(record.id, record);
      order.push(record.id);
      // shift() is O(n), which is irrelevant at a few hundred entries.
      while (order.length > limit) byId.delete(order.shift()!);
    },
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    acknowledge(id, operator, at) {
      const record = byId.get(id);
      if (!record || record.acknowledgement) return record;
      const acknowledged = { ...record, acknowledgement: { operator, at } };
      byId.set(id, acknowledged);
      return acknowledged;
    },
    recent(count) {
      return order
        .slice(-count)
        .reverse()
        .map((id) => byId.get(id)!);
    },
  };
}

type AlertRow = {
  record: string;
  ack_operator: string | null;
  ack_at: string | null;
};

/**
 * Keeps every alert in the `alerts` table, so alerts and acknowledgements
 * survive a restart and form an audit trail. Only `recent` is limited.
 */
export function createSqliteAlertStore(db: DatabaseSync): AlertStore {
  const insert = db.prepare(
    "INSERT INTO alerts (id, record, received_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING",
  );
  const byId = db.prepare(
    "SELECT record, ack_operator, ack_at FROM alerts WHERE id = ?",
  );
  // The WHERE clause makes "first one wins" a single atomic statement.
  const ack = db.prepare(
    "UPDATE alerts SET ack_operator = ?, ack_user_id = ?, ack_at = ? WHERE id = ? AND ack_at IS NULL",
  );
  const newest = db.prepare(
    "SELECT record, ack_operator, ack_at FROM alerts ORDER BY received_at DESC, rowid DESC LIMIT ?",
  );

  const get = (id: string) => {
    const row = byId.get(id) as AlertRow | undefined;
    return row && toRecord(row);
  };

  return {
    add(record) {
      const { acknowledgement, ...rest } = record;
      insert.run(record.id, JSON.stringify(rest), record.receivedAt);
    },
    get,
    has: (id) => byId.get(id) !== undefined,
    acknowledge(id, operator, at, userId) {
      ack.run(operator, userId ?? null, at, id);
      return get(id);
    },
    recent: (count) => (newest.all(count) as AlertRow[]).map(toRecord),
  };
}

function toRecord(row: AlertRow): AlertRecord {
  const record = JSON.parse(row.record) as Omit<AlertRecord, "acknowledgement">;
  return {
    ...record,
    acknowledgement:
      row.ack_operator !== null && row.ack_at !== null
        ? { operator: row.ack_operator, at: row.ack_at }
        : null,
  };
}
