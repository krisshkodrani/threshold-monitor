# ADR 0004: At-least-once delivery with server-side dedupe

Status: accepted (M2, M5)

## Context

The connection between the monitor and the relay can fail at any time. An
alert must not be lost, and the control room must not show it twice.

## Decision

- The monitor gives each alert a UUID. The relay uses this id as an
  idempotency key.
- The monitor keeps an outbox. It sends alerts only after `welcome`, in the
  order of creation. Each sent alert waits 5 s for `accepted`.
- After a timeout or a disconnect, the alert goes back into the queue in its
  original position. The monitor sends it again with the same id.
- The relay answers a repeated id with `accepted` and `duplicate: true`. It
  does not send the alert to the control rooms again.
- After a reconnect, the monitor compares `welcome.recent` with its outbox.
  Alerts that the relay already has are not sent again. Acknowledgements made
  while the monitor was offline appear from the same list.
- The outbox holds at most 50 alerts. If it is full, the oldest alert is
  dropped, and the monitor shows "Dropped".
- Reconnect delay: `min(30 s, 500 ms × 2^n) × (0.5 + random × 0.5)`. The
  attempt counter resets after each `welcome`. Close code 4002 stops all retries.

## Consequences

- An alert is stored once, also when the network loses `accepted`.
- The relay's rate limit must accept a full outbox at once (ADR 0005).
- The relay keeps alerts in memory only. If the relay restarts, the monitor
  sends its pending alerts again, but alerts accepted before the restart are
  not in the new relay's list.
