# Architecture

This document describes the parts of the system, where each piece of state
lives, the message flow, and the limits of the current design. The ADRs in
[docs/adr](adr) give the reasons for each decision.

## Parts

```
 ┌──────────────────┐            ┌───────────────────┐            ┌──────────────────┐
 │ apps/monitor     │  alert     │ server (relay)    │  alert     │ apps/control     │
 │ data source      │──────────▶ │ /ws  validation   │──────────▶ │ alarm list       │
 │ detector         │ ◀────────  │      routing      │ ◀────────  │ Acknowledge      │
 │ outbox           │  accepted  │ /login, /api      │  ack       │                  │
 └──────────────────┘            │ SQLite: users,    │            └──────────────────┘
          ▲                      │ sessions, alerts  │                     ▲
          │                      └───────────────────┘                     │
          └──────────────── acknowledged (to all clients) ─────────────────┘
                    packages/protocol: zod schemas used by all three
```

| Part                | Main files                                                                         |
| ------------------- | ---------------------------------------------------------------------------------- |
| `packages/protocol` | `messages.ts` (schemas), `parse.ts` (parse functions that do not throw)            |
| `apps/monitor`      | `domain/crossing.ts`, `transport/outbox.ts`, `transport/websocketTransport.ts`     |
| `server`            | `relay.ts` (sockets), `routing.ts` (rules, no sockets), `alertStore.ts`, `http.ts` |
| `server` (auth)     | `db.ts` (SQLite, migrations), `users.ts`, `sessions.ts`, `loginPage.ts`, `cli.ts`  |
| `apps/control`      | `state/alarms.ts` (reducer), `connection/relayConnection.ts`, `App.tsx`            |

## Where state lives

| State                         | Where                                       | Lifetime                    |
| ----------------------------- | ------------------------------------------- | --------------------------- |
| Live readings (last 120)      | Monitor: ring buffer outside Redux          | Page                        |
| Threshold and hysteresis      | Monitor: Redux, saved in `localStorage`     | Browser                     |
| Monitor identity (`sourceId`) | Monitor: `sessionStorage`                   | Browser tab                 |
| Alerts and delivery status    | Monitor: Redux (at most 200)                | Page                        |
| Outbox                        | Monitor: transport (at most 50)             | Page                        |
| Stored alerts                 | Relay: SQLite table `alerts` (all of them)  | Database file               |
| Users and sessions            | Relay: SQLite tables `users` and `sessions` | Database file; 12 h session |
| Session token                 | Browser: `HttpOnly` cookie `tm_session`     | Until logout or expiry      |
| Alarm list                    | Control room: `useReducer` (at most 500)    | Page; refilled by `welcome` |

Live readings do not go through Redux. Only the chart and the readout render
again for each reading.

## Message flow

1. The page asks `GET /api/session`. If there is no session, it goes to the
   relay's `/login` page, which sets the session cookie and comes back.
2. The client opens `/ws`; the browser sends the cookie with the upgrade. The
   relay closes a socket without a valid session with code 4003.
3. The client sends `hello` with its role. The role must be one of the user's
   roles (`monitor`, or `operator` for a control room). The relay answers with
   `welcome`, which contains up to 100 recent alerts, newest first.
4. The monitor detects a crossing, puts the alert in its outbox and sends it.
5. The relay validates the alert, stores it with its own `receivedAt` time,
   answers `accepted` to the monitor, and sends `alert` to each control room.
6. An operator clicks Acknowledge. The control room sends `ack` with the alert
   id only.
7. The relay records the first acknowledgement, with the display name and id
   of the session's user, and sends `acknowledged` to all clients. The monitor
   shows "Acknowledged by" and the operator name.

If a connection fails at any step, the client reconnects with backoff, and
`welcome.recent` fills the gaps (ADR 0004).

## Scaling and limits

The current design is one relay process with a local SQLite file. This is
sufficient for one site with a few monitors and control rooms. These are the
limits, and the changes that each limit needs. None of these changes is built.

| Limit                                       | Effect                                                                                    | Next step                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| One relay process, local SQLite file        | All sockets are on one machine; no failover                                               | Several relays with a shared store and a publish/subscribe channel between them (for example Redis) |
| `welcome` sends at most 100 alerts          | A long disconnect can miss older alerts                                                   | Let a client ask for alerts after a given time                                                      |
| Outbox in memory only                       | If the session ends while the monitor is offline, the queued alerts are lost at the login | Keep the outbox in `sessionStorage`                                                                 |
| Users are added with a CLI only             | No page to manage users or change a password                                              | An admin page, password change, and single sign-on (OIDC) with the same session cookie              |
| The alerts table grows without a limit      | The database file grows over time                                                         | A retention job that deletes old acknowledged alerts                                                |
| One threshold, one metric, one source       | The monitor watches one value only                                                        | High and low thresholds, more data sources                                                          |
| SVG chart (Recharts)                        | Not tested above 10 readings each second                                                  | A canvas chart for high rates                                                                       |
| Monitor bundle approximately 200 KB gzipped | Most of it is Recharts                                                                    | Load the chart with a dynamic `import()`                                                            |

With several relays, a client can connect to any relay, because each message
carries all its data and dedupe uses the alert id. The shared store must make
"store if new" and "first acknowledgement wins" atomic.
