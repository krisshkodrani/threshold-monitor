# Architecture

This document describes the parts of the system, where each piece of state
lives, the message flow, and the limits of the current design. The ADRs in
[docs/adr](adr) give the reasons for each decision.

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
        acknowledged, sensorStatus: from the relay to all clients
                packages/protocol: zod schemas used by all four
```

| Part                | Main files                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/protocol` | `messages.ts` (schemas), `parse.ts` (parse functions that do not throw)                                |
| `packages/ui`       | `DataTable.tsx` (generic table with column definitions; scroll box, sticky header)                     |
| `sensor`            | `agent.ts` (the loop), `domain/crossing.ts`, `transport/outbox.ts`, `transport/websocketTransport.ts`  |
| `server`            | `relay.ts` (sockets), `routing.ts` (rules, no sockets), `alertStore.ts`, `settingsStore.ts`, `http.ts` |
| `server` (auth)     | `db.ts` (SQLite, migrations), `users.ts`, `sessions.ts`, `loginPage.ts`, `cli.ts`                      |
| `apps/monitor`      | `connection/relayConnection.ts`, `store/` (Redux), `data/readingsStore.ts`, `App.tsx`                  |
| `apps/control`      | `state/alarms.ts` (reducer), `connection/relayConnection.ts`, `App.tsx`                                |

## Where state lives

| State                    | Where                                         | Lifetime                    |
| ------------------------ | --------------------------------------------- | --------------------------- |
| Detector and outbox      | Sensor: process memory (outbox at most 50)    | Sensor process              |
| Last 120 readings        | Relay: memory, for `welcome`                  | Relay process               |
| Live readings in a tab   | Monitor: ring buffer outside Redux            | Page                        |
| Threshold and hysteresis | Relay: SQLite table `settings`, with the user | Database file               |
| Alerts                   | Relay: SQLite table `alerts` (all of them)    | Database file               |
| Users and sessions       | Relay: SQLite tables `users` and `sessions`   | Database file; 12 h session |
| Session token            | Browser: `HttpOnly` cookie `tm_session`       | Until logout or expiry      |
| Alert log, settings      | Monitor: Redux, a copy of the relay's state   | Page; refilled by `welcome` |
| Alarm list               | Control room: `useReducer` (at most 500)      | Page; refilled by `welcome` |

Live readings do not go through Redux. Only the chart and the readout render
again for each reading.

## Message flow

1. The sensor opens `/ws` and sends `hello` with the role `sensor`, its token
   and its info. The relay checks the token, sends `sensorStatus` to all
   browsers, and answers `welcome` with the stored settings.
2. If the relay has no settings, the sensor sends `settingsApplied` with its
   defaults. The relay stores them and sends `settings` to the monitors.
3. A page asks `GET /api/session`. If there is no session, it goes to the
   relay's `/login` page, which sets the session cookie and comes back.
4. The page opens `/ws`; the browser sends the cookie with the upgrade. The
   relay closes a socket without a valid session with code 4003.
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
   new settings from the next reading.

If a connection fails at any step, the client reconnects with backoff, and
`welcome` fills the gaps (ADR 0004, ADR 0009).

## Scaling and limits

The current design is one relay process with a local SQLite file. This is
sufficient for one site with one sensor and a few monitors and control rooms.
These are the limits, and the changes that each limit needs. None of these
changes is built.

| Limit                                  | Effect                                                                                 | Next step                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| One relay process, local SQLite file   | All sockets are on one machine; no failover                                            | Several relays with a shared store and a publish/subscribe channel between them (for example Redis) |
| `welcome` sends at most 100 alerts     | A long disconnect can miss older alerts                                                | Let a client ask for alerts after a given time                                                      |
| Outbox in memory only                  | If the relay is offline for the 3 s drain at a sensor stop, the queued alerts are lost | Keep the outbox in a file next to the sensor                                                        |
| Users are added with a CLI only        | No page to manage users or change a password                                           | An admin page, password change, and single sign-on (OIDC) with the same session cookie              |
| The alerts table grows without a limit | The database file grows over time                                                      | A retention job that deletes old acknowledged alerts                                                |
| One sensor, one threshold, one metric  | A sensor with a different id is refused (4005)                                         | A sensor id in each message, a sensor choice in the monitor, high and low thresholds                |
| Readings at most once, not stored      | A gap in the relay connection is a gap in the chart                                    | Store the readings, or let the sensor send the missed ones after a reconnect                        |
| SVG chart (Recharts)                   | Not tested above 10 readings each second                                               | A canvas chart for high rates                                                                       |
| No error tracking, metrics or tracing  | Errors are only in the logs and the browser console                                    | Sentry (with source maps), a `/metrics` endpoint, OpenTelemetry                                     |

With several relays, a client can connect to any relay, because each message
carries all its data and dedupe uses the alert id. The shared store must make
"store if new" and "first acknowledgement wins" atomic.
