# Proposed reliability and history improvements

Status: proposal. None of the changes described here is implemented by this
document. [architecture.md](architecture.md) describes the current system.

This guide explains how five improvements would fit into the existing code.
File links identify the code to extend; proposed new files are explicitly named.
The sensor would continue to detect crossings, the relay would own durable
shared state, and the browser apps would display that state.

## 1. Recover missed alerts and acknowledgements

### Current behavior and problem

The relay sends up to 100 recent alerts in `welcome`.
[The monitor](../apps/monitor/src/store/alertsSlice.ts) replaces its collection;
[the control room](../apps/control/src/state/alarms.ts) merges that snapshot
into its existing collection.

Suppose the control room holds alarm A and disconnects. Another operator
acknowledges A, then 150 newer alerts arrive. On reconnect, A is absent from
`welcome.recent`, so the first control room can still show A as unacknowledged.

### Proposed design

Add a durable, ordered change log covering alert creation and acknowledgement.
Each change gets an increasing sequence number. A client remembers the sequence
of the last change it applied and requests subsequent changes on reconnect.
Use sequence numbers rather than timestamps: events can share timestamps, and
an old alert can receive a new acknowledgement.

An alert mutation and its change-log entry must commit in the same SQLite
transaction. Otherwise a crash could save an acknowledgement without making it
available for replay. Duplicate alert submissions and repeated acknowledgements
must not create extra changes when stored state has not changed.

Keep a database generation identifier with the cursor. If the database is
replaced, or a cursor is older than retained changes, return an explicit reset
response. A reset replaces client state from a fresh snapshot and tells the user
that prior local history could not be reconciled; it must not silently preserve
stale alarms.

For a fresh connection, capture a snapshot and its sequence boundary consistently.
For reconnect, replay changes after the client's cursor. Deliver live changes
through the same ordered stream, so a live event cannot advance the cursor past
an unapplied replay page. One approach is to page through the durable log up to
a captured boundary, then continue draining newer entries from that log.

Apply each page before advancing the cursor. Keep the cursor with the state it
describes: a browser reload discards both and starts from a fresh snapshot.
Persisting a cursor alone would cause a fresh UI to skip data it has never loaded.
UI collections can remain bounded; replay completeness does not require every
historical alert to remain visible.

### Code affected

| File                                                                                                             | Proposed responsibility                                                              |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [server/src/db.ts](../server/src/db.ts)                                                                          | Add a migration for the change log and database generation.                          |
| [server/src/alertStore.ts](../server/src/alertStore.ts)                                                          | Make mutations and log writes atomic; expose snapshot and ordered change queries.    |
| [server/src/routing.ts](../server/src/routing.ts)                                                                | Route committed changes and authorized recovery requests.                            |
| [server/src/relay.ts](../server/src/relay.ts)                                                                    | Coordinate snapshot, replay, and live delivery without gaps.                         |
| [packages/protocol/src/messages.ts](../packages/protocol/src/messages.ts)                                        | Define cursor, replay page, completion, and reset messages; update protocol version. |
| [packages/client/src/relayConnection.ts](../packages/client/src/relayConnection.ts)                              | Handle reconnection and recovery negotiation for both browser roles.                 |
| [apps/monitor/src/App.tsx](../apps/monitor/src/App.tsx), [apps/control/src/App.tsx](../apps/control/src/App.tsx) | Apply recovered changes and track the cursor only after successful application.      |
| The two alert reducers linked above                                                                              | Merge replayed records idempotently and handle an explicit reset.                    |

Replay pages should be bounded by encoded byte size as well as record count.
Keep recovery messages within a defined payload budget consistent with the
protocol's existing 16 KiB message limit. Authorize recovery for browser roles;
the sensor continues to use alert IDs and `accepted` for delivery confirmation.
A protocol version change requires updating and deploying the relay, sensor,
and both browser apps together under the current compatibility policy.

### Verification

- Disconnect a control room, acknowledge an old alarm, create more than 100 new
  alerts, reconnect, and verify the old acknowledgement is recovered.
- Inject new alerts during paginated recovery; verify no event is skipped and
  no duplicate row appears.
- Repeat a replay page and disconnect midway through recovery; verify resuming
  produces the same state.
- Replace the database or expire a cursor; verify an explicit reset occurs.
- Verify rollback leaves neither a partial mutation nor an orphaned log entry.

Extend the store, routing, relay, browser connection, and reducer tests. Add a
Playwright scenario for the visible stale-alarm failure.

## 2. Persist the sensor's outbox

### Current behavior and problem

[outbox.ts](../sensor/src/transport/outbox.ts) keeps queued and pending alerts in
memory. [index.ts](../sensor/src/index.ts) allows three seconds to drain them
during shutdown. An abrupt exit loses everything not yet accepted.

### Proposed design

Introduce a sensor-local SQLite store of unaccepted alerts. Persist the complete
alert, its existing UUID, sensor identity, and creation sequence before making
it eligible for transmission. Delete it only after `accepted` or confirmation
through `welcome.recent`.

On startup, load durable entries in creation order. Treat all of them as queued:
previous socket state and acknowledgement deadlines have no meaning after a
restart. If the relay stored an alert just before the sensor crashed, resending
the same UUID remains safe because the relay deduplicates it.

Use the durable store as the authority for outstanding alerts. Keep only the
active send window and timeout bookkeeping in memory. The existing queue limit
of 50 must not accidentally delete a durable backlog when it is reloaded or
requeued. Define a separate configurable storage limit and a visible overflow
policy. For an initial implementation, stop with an explicit error on storage
failure or capacity exhaustion rather than claim the alert was safely queued.
This still leaves a documented limitation: detection stops until the fault is
resolved. Persistence cannot guarantee delivery when storage is unavailable.

### Code affected

| File                                                                                           | Proposed responsibility                                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| New `sensor/src/storage/outboxStore.ts`                                                        | SQLite persistence, ordered reads, acceptance deletion, and storage migrations.             |
| [sensor/src/transport/websocketTransport.ts](../sensor/src/transport/websocketTransport.ts)    | Persist before sending; remove durable entries on confirmation; recover on startup.         |
| [sensor/src/transport/outbox.ts](../sensor/src/transport/outbox.ts)                            | Retain pure scheduling logic while separating the send-window limit from durable capacity.  |
| [sensor/src/transport/AlertTransport.ts](../sensor/src/transport/AlertTransport.ts)            | Specify how persistence failures are reported to the caller.                                |
| [sensor/src/config.ts](../sensor/src/config.ts), [sensor/src/index.ts](../sensor/src/index.ts) | Configure and open the store; close it during shutdown.                                     |
| [docker-compose.yml](../docker-compose.yml)                                                    | Add a separate writable sensor volume for its outbox; keep the relay token mount read-only. |

Test restart recovery using a temporary database, including crashes before send
and after relay acceptance but before local deletion. Also test database errors,
capacity handling, and reopening a volume containing another sensor's alerts.
Require matching sensor identity before replaying that backlog.

## 3. Make stale readings visible

### Current behavior and problem

[App.tsx](../apps/monitor/src/App.tsx) updates sensor status on `sensorStatus`,
but leaves the readings buffer intact. The readout can therefore show an old
temperature after a disconnect. The chart's right edge is labelled “now” relative
to its newest reading, even if no new reading has arrived recently.

### Proposed design

Track when the browser last received a reading, alongside its sensor sample
timestamp. Distinguish waiting for data, live, delayed, sensor offline, and relay
disconnected. A starting proposal for delayed data is no reading for the greater
of three expected sampling periods or five seconds; make that policy explicit
and test it with an injected clock.

Use local elapsed time for missing-message detection so browser/server clock
skew does not create false alarms. Display the sample timestamp separately.
Readings supplied by `welcome` are historical: receiving the snapshot must not
mark them as freshly sampled. Wait for a live reading before showing “live”.

Retain the last value as context, label it stale, and show its last sample time.
On the chart, use “latest sample” or an actual sample time instead of implying
that the right edge is current wall-clock time. If the sensor identity changes,
clear the old series so temperatures from two sources are not joined together.

### Code affected

- [data/readingsStore.ts](../apps/monitor/src/data/readingsStore.ts): retain
  freshness metadata separately from sample values and timestamps.
- New `apps/monitor/src/hooks/useReadingFreshness.ts`: derive freshness from
  connection state, sensor status, sampling rate, and elapsed time. Re-evaluate
  when the tab becomes visible because hidden tabs can throttle timers.
- [App.tsx](../apps/monitor/src/App.tsx): distinguish snapshot replacement from
  live arrival and handle sensor identity changes.
- [ReadoutBar.tsx](../apps/monitor/src/components/ReadoutBar.tsx),
  [LiveChart.tsx](../apps/monitor/src/components/LiveChart.tsx), and
  [SensorPanel.tsx](../apps/monitor/src/components/SensorPanel.tsx): show freshness
  and last sample time without relying on color alone.

Test an idle but connected sensor, sensor disconnect, relay disconnect, recovery,
an old welcome snapshot, and returning to a backgrounded tab. Only freshness
subscribers should need timer-driven rendering; keep readings outside Redux.

## 4. Store temperature history when required

### Current behavior and problem

[readingsBuffer.ts](../server/src/readingsBuffer.ts) retains only 120 readings in
memory. SQLite alerts contain the temperatures that triggered crossings, but
there is no continuous historical temperature series.

### Proposed design

Add an optional relay-side readings store with sensor ID, sample time, value,
and receipt time. Append an internal ingestion ID to give pagination a stable
tie-breaker. Index by sensor and sample time for range queries.

Keep the existing live WebSocket path and in-memory buffer. Write readings in
small batches to avoid a transaction for every sample; document that a crash
can lose the uncommitted batch. This records readings the relay received only:
it cannot recover measurements lost during a sensor disconnection.

Expose an authenticated, monitor-authorized history API with sensor, start/end
time, resolution, and bounded page size. Define response schemas in the protocol
package. A separate history view should fetch this data without replacing the
live 120-reading buffer.

Decide resolution and retention before implementation. At 10 readings per second,
one sensor produces 864,000 rows per day. One possible policy is short-lived raw
data plus longer-lived minute summaries containing minimum, maximum, average,
and sample count. Min/max preserve excursions that an average would hide.
Missing samples must remain visible as gaps or low counts, not fabricated values.

### Code affected

- [server/src/db.ts](../server/src/db.ts): add reading and optional summary tables.
- New `server/src/readingsStore.ts`: batched writes, range queries, aggregation.
- [server/src/routing.ts](../server/src/routing.ts): hand validated sensor
  readings to the store through an injected interface.
- [server/src/index.ts](../server/src/index.ts): own batch flushing and shutdown.
- [server/src/http.ts](../server/src/http.ts): validate and authorize history queries.
- New monitor history component and data-fetching module: range selection,
  loading/error states, and bounded chart data.

Verify range boundaries, stable pagination, mixed sensor IDs, aggregation accuracy,
authorization, and missing-data display. Measure write load and database growth
at the supported 10 Hz rate before choosing retention defaults.

## 5. Add alert history browsing and retention

### Current behavior and problem

[alertStore.ts](../server/src/alertStore.ts) keeps all alerts indefinitely, but
browser collections and reconnect snapshots are bounded. Older persisted records
are neither conveniently browsable nor automatically expired.

### Proposed design

Add authenticated, role-authorized, paginated alert queries with time, sensor,
and acknowledgement filters. Use a stable cursor containing receipt time and a
unique tie-breaker rather than offsets, which shift when new alerts arrive.
History results belong in a separate view from the active live list.

Add configurable retention, disabled until a deployment selects its policy.
Initially delete only acknowledged alerts older than the configured cutoff,
using acknowledgement time so a newly resolved old alert is not immediately
removed. Run bounded cleanup batches rather than a large blocking transaction.

Retention must coordinate with reliability features:

- Deleting an alert also removes its current deduplication record. A delayed
  retry could then recreate it as a new, unacknowledged alarm. Preserve an alert-ID
  tombstone with enough metadata to return `accepted`, or define and enforce a
  maximum retry age before expiring deduplication records. An indefinitely
  durable sensor backlog requires indefinitely retained IDs unless that retry
  contract changes.
- The replay log needs its own retention policy; otherwise deleting alerts does
  not bound database growth. Expired cursors must trigger the explicit reset
  described in proposal 1.
- Online clients need a deletion change or equivalent invalidation so retained
  browser state does not keep records that the server intentionally removed.
- Historical query pages must handle records being removed between requests.

### Code affected and verification

Extend the alert store and HTTP handlers for filtered queries. Add a migration
for required indexes and tombstones, and a proposed `server/src/retention.ts`
module for cleanup. Configure scheduling through server config and startup.
Add history screens to the browser apps using the existing shared table.

Test that open alarms survive cleanup, recently acknowledged alarms survive,
late sensor retries do not recreate deleted alarms, expired replay cursors
reset correctly, and concurrent inserts do not duplicate or skip history rows.
Verify indexes and cleanup batch sizes with a realistically sized database.

## Suggested implementation order

1. Reconnect recovery: fixes the stale acknowledgement correctness gap.
2. Stale-reading indication: makes connection failures visible to users.
3. Durable sensor outbox: protects alerts across process restarts.
4. History browsing and retention: makes stored data accessible and manages growth.
5. Temperature history: add after deciding the actual historical-data requirement.

For each implementation, add the focused tests above, run the affected package
tests plus typecheck and lint, and update the current architecture documentation.
Protocol changes also need the cross-service integration and Playwright flows.
Storage and deployment changes need migration/restart and Docker checks. Existing
ADRs can be extended by new decisions once a proposal is accepted and implemented.
