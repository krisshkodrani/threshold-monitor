# Architecture

This document describes the parts of the system, where each piece of state
lives, the message flow, and the limits of the current design. The ADRs in
[docs/adr](adr) give the reasons for each decision.

Open the [interactive architecture guide](architecture-guide.html) in a browser
for the system map, playable temperature simulation, and source excerpts.
Its React app and simulator reducer live in
[apps/architecture-guide](../apps/architecture-guide); the HTML is a generated
offline export.

[Proposed improvements](proposed-improvements.md) explains possible code changes
for recovery, durable delivery, freshness, and history. Those proposals are not
part of the current implementation described here.

## Parts

```
 ┌──────────────────┐            ┌───────────────────┐  alert      ┌──────────────────┐
 │ sensor/ (Node)   │  reading   │ server (relay)    │──────────▶  │ apps/control     │
 │ data source      │  alert     │ /ws  validation   │ ◀────────   │ alarm list       │
 │ detector         │──────────▶ │      routing      │  ack        │ Acknowledge      │
 │ outbox           │ ◀────────  │ /login, /api      │             └──────────────────┘
 └──────────────────┘  accepted  │ SQLite: users,    │  reading,
                       settings  │ sessions, alerts, │  alert,     ┌──────────────────┐
                                 │ settings          │──────────▶  │ apps/monitor     │
                                 │ last 120 readings │ ◀────────   │ chart, alert log │
                                 └───────────────────┘ setSettings │ settings form    │
                                                                   └──────────────────┘
        acknowledged: to all clients; sensorStatus: to browsers
                packages/protocol: zod schemas used by all four
```

| Part                | Main files                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `packages/protocol` | `messages.ts` (schemas), `parse.ts` (parse functions that do not throw)                                 |
| `packages/ui`       | `DataTable.tsx` (generic table with column definitions; scroll box, sticky header), `ErrorBoundary.tsx` |
| `sensor`            | `agent.ts` (the loop), `domain/crossing.ts`, `transport/outbox.ts`, `transport/websocketTransport.ts`   |
| `server`            | `relay.ts` (sockets), `routing.ts` (rules, no sockets), `alertStore.ts`, `settingsStore.ts`, `http.ts`  |
| `server` (auth)     | `db.ts` (SQLite, migrations), `users.ts`, `sessions.ts`, `loginPage.ts`, `cli.ts`                       |
| `packages/client`   | `relayConnection.ts` (both roles), `useRelay.ts`, `auth.ts`, `ConnectionBadge.tsx`, `AccountBar.tsx`    |
| `apps/monitor`      | `store/` (Redux), `data/readingsStore.ts`, `App.tsx`                                                    |
| `apps/control`      | `state/alarms.ts` (reducer), `App.tsx`                                                                  |

## Where state lives

| State                    | Where                                                       | Lifetime                                             |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------------- |
| Detector and outbox      | Sensor: process memory (queue at most 50; pending separate) | Sensor process                                       |
| Last 120 readings        | Relay: memory, for `welcome`                                | Until sensor disconnects or connects, or relay stops |
| Live readings in a tab   | Monitor: ring buffer outside Redux                          | Page                                                 |
| Threshold and hysteresis | Relay: SQLite table `settings`, with the user               | Database file                                        |
| Alerts                   | Relay: SQLite table `alerts` (all of them)                  | Database file                                        |
| Users and sessions       | Relay: SQLite tables `users` and `sessions`                 | Database file; 12 h session                          |
| Session token            | Browser: `HttpOnly` cookie `tm_session`                     | Until logout or expiry                               |
| Alert log, settings      | Monitor: Redux (200 alerts retained; 50 shown), settings    | Page; refilled by `welcome`                          |
| Alarm list               | Control room: `useReducer` (at most 500)                    | Page; merged with `welcome`                          |

Live readings do not go through Redux. Only the chart and the readout render
again for each reading.

## Message flow

1. The sensor opens `/ws` and sends `hello` with the role `sensor`, its token
   and its info. The relay checks the token, answers `welcome` with the
   stored settings, and sends `sensorStatus` to all browsers.
2. If the relay has no settings, the sensor sends `settingsApplied` with its
   defaults. The relay stores them and sends `settings` to the monitors.
3. A page asks `GET /api/session`. If there is no session, it goes to the
   relay's `/login` page, which sets the session cookie and comes back.
4. The page opens `/ws`; the browser sends the cookie with the upgrade. The
   relay looks up the session but allows the upgrade without one, because
   sensors authenticate in `hello`. A browser without a valid session is
   closed with code 4003 when it sends `hello`.
5. The page sends `hello` with its role. The role must be one of the user's
   roles (`monitor`, or `operator` for a control room). The relay answers
   with `welcome`: up to 100 recent alerts (newest first), the settings, the
   sensor and, for a monitor, the last 120 readings.
6. The sensor sends each `reading`. The relay sends it to all monitors.
7. The sensor detects a crossing, puts the alert in its outbox and sends it.
   The relay validates the alert, stores it with its own `receivedAt` time,
   answers `accepted` to the sensor, and sends `alert` to the monitors and
   the control rooms.
8. An operator clicks Acknowledge. The control room sends `ack` with the alert
   id only. The relay records the first acknowledgement, with the display
   name and id of the session's user, and sends `acknowledged` to all
   clients. The monitor shows "Acknowledged by" and the operator name.
9. A user changes the threshold in a monitor. The monitor sends
   `setSettings`. The relay stores the settings with the user's name and
   sends `settings` to the sensor and to all monitors. The sensor uses the
   new settings from the next reading. Without a connected sensor, the relay
   updates the last stored sensor settings; if no sensor has connected and no
   settings exist, it refuses the change.

The two apps sort alerts by different times, on purpose. The monitor sorts
by `eventTime` (when the sensor took the reading), so the alert log matches
the chart. The control room sorts by `receivedAt` (when the relay stored the
alert), so an operator sees the newest arrival at the top. The two orders are
different only after a relay outage, when the sensor sends old alerts late.

## Delivery and reconnect recovery

Clients reconnect with backoff after connection failures. Unsupported protocol
versions stop retries; unauthenticated browser clients return to login. The
sensor stops on an authentication refusal.

Alerts retained by the running sensor are retried until accepted, with relay
storage deduplicated by alert id. This is conditional at-least-once delivery:
the sensor can drop alerts on queue overflow or process exit. The queue holds
at most 50 alerts; sent alerts live in a separate pending list and do not count
toward that limit. A timeout or disconnect merges pending alerts back into the
queue in creation order and applies the queue limit, dropping the oldest
entries. Drops are logged by the sensor, not displayed as a monitor status.

`welcome` is a bounded snapshot, not a complete replay. It includes at most
100 recent alerts ordered by relay receipt time. The sensor receives only its
own alerts from that snapshot and removes matching ids from its outbox. Alerts
outside the snapshot can still be resent and deduplicated by the relay.

The two browser apps reconcile the snapshot differently:

- The monitor replaces its alert collection with `welcome.recent`, then sorts
  by event time. It retains at most 200 alerts during live operation and shows
  the newest 50 in the log. Reconnecting can remove older alerts from the tab.
- The control room merges `welcome.recent` into its existing list, retaining
  at most 500 alarms. An acknowledgement missed while disconnected is recovered
  only if that alarm is in the snapshot. An older retained alarm can therefore
  remain visibly unacknowledged even though SQLite records its acknowledgement.
  Reloading starts a fresh list from the snapshot.

There is no alert history or acknowledgement lookup API to fill these gaps.
Complete reconciliation needs replay after a cursor or a lookup of retained
alarm ids; neither is implemented.

Readings are sent only while the sensor has completed its handshake, without
retry or durable storage. A monitor reconnect receives up to 120 readings still
in the relay's memory. The relay clears this buffer when a sensor disconnects
or connects. Existing monitor tabs keep their current readings on `sensorStatus`
and replace them on their next `welcome`; a sensor status change alone does not
clear the chart. Slow browser connections also skip readings when their send
buffer exceeds 1 MiB. These mechanisms do not guarantee a continuous chart.

## Deployment

Production serves both built apps, login, HTTP APIs and `/ws` from one Node
process and origin. SQLite stores users, sessions, alerts and settings. The
sensor is a separate Node process and currently uses a seeded random-walk data
source. `docker-compose.yml` runs both processes from the same image, with the
relay writing a persistent data volume and the sensor mounting it read-only.
Unless `SENSOR_TOKEN` is supplied, the relay creates a token file in that volume
and the sensor reads it through `SENSOR_TOKEN_FILE`. Compose enables demo users
by default; the server's own default is to leave them disabled.

The relay also exposes `/healthz` for liveness and `/readyz` for database and
shutdown readiness. HTTPS is provided by an external reverse proxy; deployments
configure `COOKIE_SECURE` and, for one trusted proxy, `TRUST_PROXY`.

## Scaling and limits

The current design is one relay process with a local SQLite file. This is
sufficient for one site with one sensor and a few monitors and control rooms.
These are the limits, and the changes that each limit needs. None of these
changes is built.

| Limit                                  | Effect                                                                                            | Next step                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| One relay process, local SQLite file   | All sockets are on one machine; no failover                                                       | Several relays with a shared store and a publish/subscribe channel between them (for example Redis) |
| `welcome` sends at most 100 alerts     | A long disconnect can miss alerts and acknowledgements; retained control-room alarms can be stale | Let a client ask for alerts after a given time                                                      |
| Outbox in memory only                  | If the relay is offline for the 3 s drain at a sensor stop, the queued alerts are lost            | Keep the outbox in a file next to the sensor                                                        |
| Users are added with a CLI only        | No page to manage users or change a password                                                      | An admin page, password change, and single sign-on (OIDC) with the same session cookie              |
| The alerts table grows without a limit | The database file grows over time                                                                 | A retention job that deletes old acknowledged alerts                                                |
| One sensor, one threshold, one metric  | While a sensor is connected, a different id is refused (4005); the same id replaces its socket    | A sensor id in each message, a sensor choice in the monitor, high and low thresholds                |
| Readings at most once, not stored      | A gap in the relay connection is a gap in the chart                                               | Store the readings, or let the sensor send the missed ones after a reconnect                        |
| SVG chart (Recharts)                   | Not tested above 10 readings each second                                                          | A canvas chart for high rates                                                                       |
| No error tracking, metrics or tracing  | Errors are only in the logs and the browser console                                               | Sentry (with source maps), a `/metrics` endpoint, OpenTelemetry                                     |

With several relays, a client can connect to any relay, because each message
carries all its data and dedupe uses the alert id. The shared store must make
"store if new" and "first acknowledgement wins" atomic.
