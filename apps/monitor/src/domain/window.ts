/**
 * Fixed-capacity ring buffer: once full, each push overwrites the oldest item,
 * so memory stays bounded no matter how long the app runs.
 *
 * `toArray()` returns the same array instance until the next `push`. That makes
 * it safe as a `useSyncExternalStore` snapshot: React compares snapshots by
 * identity, and a fresh array on every call would re-render forever.
 */
export class RingBuffer<T> {
  readonly capacity: number;
  private readonly items: T[] = [];
  private start = 0; // index of the oldest item once the buffer is full
  private snapshot: readonly T[] | null = null;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(
        `capacity must be a positive integer, got ${capacity}`,
      );
    }
    this.capacity = capacity;
  }

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    if (this.items.length < this.capacity) {
      this.items.push(item);
    } else {
      this.items[this.start] = item;
      this.start = (this.start + 1) % this.capacity;
    }
    this.snapshot = null;
  }

  /** Items from oldest to newest. Same instance until the next push. */
  toArray(): readonly T[] {
    this.snapshot ??= [
      ...this.items.slice(this.start),
      ...this.items.slice(0, this.start),
    ];
    return this.snapshot;
  }
}
