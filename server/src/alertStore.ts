import type { AlertRecord } from "@app/protocol";

/**
 * Where the relay keeps alerts. Everything else talks to this interface, so the
 * in-memory version can be replaced by SQLite (or anything durable) without
 * touching the routing code (ADR 0005).
 */
export interface AlertStore {
  add(record: AlertRecord): void;
  get(id: string): AlertRecord | undefined;
  has(id: string): boolean;
  /** Sets the acknowledgement if none exists yet (first one wins). Undefined if unknown. */
  acknowledge(
    id: string,
    operator: string,
    at: string,
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
