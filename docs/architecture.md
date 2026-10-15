# Architecture

This document describes the parts of the system, where each piece of state
lives, the message flow, and the limits of the current design. The ADRs in
[docs/adr](adr) give the reasons for each decision.

## Parts

```
 ┌──────────────────┐            ┌───────────────────┐            ┌──────────────────┐
 │ apps/monitor     │  alert     │ server (relay)    │  alert     │ apps/control     │
 │ data source      │──────────▶ │ /ws  validation   │──────────▶ │ alarm list       │
 │ detector         │ ◀────────  │      routing      │ ◀────────  │ operator name    │
 │ outbox           │  accepted  │      AlertStore   │  ack       │ Acknowledge      │
 └──────────────────┘            └───────────────────┘            └──────────────────┘
          ▲            acknowledged (to all clients)                       ▲
          └────────────────────────────────────────────────────────────────┘
                    packages/protocol: zod schemas used by all three
```

| Part                | Main files                                                                         |
| ------------------- | ---------------------------------------------------------------------------------- |
| `packages/protocol` | `messages.ts` (schemas), `parse.ts` (parse functions that do not throw)            |
| `apps/monitor`      | `domain/crossing.ts`, `transport/outbox.ts`, `transport/websocketTransport.ts`     |
| `server`            | `relay.ts` (sockets), `routing.ts` (rules, no sockets), `alertStore.ts`, `http.ts` |
| `apps/control`      | `state/alarms.ts` (reducer), `connection/relayConnection.ts`, `App.tsx`            |

## Where state lives

| State                         | Where                                          | Lifetime                    |
| ----------------------------- | ---------------------------------------------- | --------------------------- |
| Live readings (last 120)      | Monitor: ring buffer outside Redux             | Page                        |
| Threshold and hysteresis      | Monitor: Redux, saved in `localStorage`        | Browser                     |
| Monitor identity (`sourceId`) | Monitor: `sessionStorage`                      | Browser tab                 |
| Alerts and delivery status    | Monitor: Redux (at most 200)                   | Page                        |
| Outbox                        | Monitor: transport (at most 50)                | Page                        |
| Stored alerts                 | Relay: `AlertStore` in memory (`RECENT_LIMIT`) | Relay process               |
| Alarm list                    | Control room: `useReducer` (at most 500)       | Page; refilled by `welcome` |
| Operator name                 | Control room: `localStorage`                   | Browser                     |

Live readings do not go through Redux. Only the chart and the readout render
again for each reading.

## Message flow

1. A client opens `/ws` and sends `hello` with its role. The relay answers with
   `welcome`, which contains up to 100 recent alerts, newest first.
2. The monitor detects a crossing, puts the alert in its outbox and sends it.
3. The relay validates the alert, stores it with its own `receivedAt` time,
   answers `accepted` to the monitor, and sends `alert` to each control room.
4. An operator clicks Acknowledge. The control room sends `ack`.
5. The relay records the first acknowledgement and sends `acknowledged` to all
   clients. The monitor shows "Acknowledged by" and the operator name.

If a connection fails at any step, the client reconnects with backoff, and
`welcome.recent` fills the gaps (ADR 0004).

## Scaling and limits

The current design is one relay process with an in-memory store. This is
sufficient for one site with a few monitors and control rooms. These are the
limits, and the changes that each limit needs. None of these changes is built.

| Limit                                       | Effect                                       | Next step                                                                                           |
| ------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Alerts are in memory only                   | A relay restart deletes all stored alerts    | Put a durable store (for example SQLite) behind the `AlertStore` interface                          |
| One relay process                           | All sockets are on one machine; no failover  | Several relays with a shared store and a publish/subscribe channel between them (for example Redis) |
| `welcome` sends at most 100 alerts          | A long disconnect can miss older alerts      | Let a client ask for alerts after a given time                                                      |
| No authentication                           | Anyone who can open the page can acknowledge | Sign-in, and a token in `hello`                                                                     |
| One threshold, one metric, one source       | The monitor watches one value only           | High and low thresholds, more data sources                                                          |
| SVG chart (Recharts)                        | Not tested above 10 readings each second     | A canvas chart for high rates                                                                       |
| Monitor bundle approximately 200 KB gzipped | Most of it is Recharts                       | Load the chart with a dynamic `import()`                                                            |

With several relays, a client can connect to any relay, because each message
carries all its data and dedupe uses the alert id. The shared store must make
"store if new" and "first acknowledgement wins" atomic.
