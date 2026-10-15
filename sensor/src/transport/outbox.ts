/**
 * Pure bookkeeping for at-least-once delivery (ADR 0004). No sockets or timers:
 * every function takes the current state and returns a new one, plus whatever
 * the caller (the transport) has to act on.
 *
 *   enqueue -> queue --takeForSend--> pending --accept--> gone
 *                ^                       |
 *                +--- expire / requeueAll+   (resend, same id; server dedupes)
 *
 * Invariant: send order equals creation order. Every entry keeps the sequence
 * number it got on enqueue, and requeued entries are merged back by it.
 */

type Entry<T> = { item: T; seq: number };
type PendingEntry<T> = Entry<T> & { deadline: number };

export type Outbox<T> = {
  readonly queue: readonly Entry<T>[];
  readonly pending: readonly PendingEntry<T>[];
  readonly capacity: number;
  readonly nextSeq: number;
};

export const DEFAULT_CAPACITY = 50;
export const ACCEPT_TIMEOUT_MS = 5_000;

export function createOutbox<T>(capacity = DEFAULT_CAPACITY): Outbox<T> {
  return { queue: [], pending: [], capacity, nextSeq: 0 };
}

export function enqueue<T>(
  state: Outbox<T>,
  item: T,
): { state: Outbox<T>; dropped: T[] } {
  const queue = [...state.queue, { item, seq: state.nextSeq }];
  return withCapacity({ ...state, queue, nextSeq: state.nextSeq + 1 });
}

/** Moves everything queued to pending, in order. The caller writes `toSend` to the socket. */
export function takeForSend<T>(
  state: Outbox<T>,
  now: number,
  timeoutMs = ACCEPT_TIMEOUT_MS,
): { state: Outbox<T>; toSend: T[] } {
  const sent = state.queue.map((entry) => ({
    ...entry,
    deadline: now + timeoutMs,
  }));
  return {
    state: { ...state, queue: [], pending: [...state.pending, ...sent] },
    toSend: sent.map((entry) => entry.item),
  };
}

/**
 * The server confirmed `id`. Removes it wherever it is: from pending (normal
 * case) or from the queue (it was requeued, or reconciled from a welcome).
 */
export function accept<T extends { id: string }>(
  state: Outbox<T>,
  id: string,
): Outbox<T> {
  return {
    ...state,
    queue: state.queue.filter((entry) => entry.item.id !== id),
    pending: state.pending.filter((entry) => entry.item.id !== id),
  };
}

/** Pending entries past their deadline go back to the queue to be resent. */
export function expire<T>(
  state: Outbox<T>,
  now: number,
): { state: Outbox<T>; expired: T[]; dropped: T[] } {
  const expired = state.pending.filter((entry) => entry.deadline <= now);
  const pending = state.pending.filter((entry) => entry.deadline > now);
  const result = withCapacity({
    ...state,
    pending,
    queue: mergeBySeq(state.queue, expired),
  });
  return { ...result, expired: expired.map((entry) => entry.item) };
}

/** The socket closed: nothing pending can be confirmed on it any more, so resend all of it. */
export function requeueAll<T>(state: Outbox<T>): {
  state: Outbox<T>;
  dropped: T[];
} {
  return withCapacity({
    ...state,
    pending: [],
    queue: mergeBySeq(state.queue, state.pending),
  });
}

/** Earliest pending deadline, so the transport needs one timer rather than one per alert. */
export function nextDeadline<T>(state: Outbox<T>): number | null {
  if (state.pending.length === 0) return null;
  return Math.min(...state.pending.map((entry) => entry.deadline));
}

/** Drops the oldest queued entries beyond capacity (backpressure while offline). */
function withCapacity<T>(state: Outbox<T>): { state: Outbox<T>; dropped: T[] } {
  const overflow = Math.max(0, state.queue.length - state.capacity);
  return {
    state: { ...state, queue: state.queue.slice(overflow) },
    dropped: state.queue.slice(0, overflow).map((entry) => entry.item),
  };
}

function mergeBySeq<T>(
  a: readonly Entry<T>[],
  b: readonly Entry<T>[],
): Entry<T>[] {
  // Strip deadlines so requeued entries are plain queue entries again.
  return [...a, ...b.map(({ item, seq }) => ({ item, seq }))].sort(
    (x, y) => x.seq - y.seq,
  );
}
