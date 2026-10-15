# Threshold Monitor

A monitor app reads a value, finds the crossings of a threshold and sends an
alert for each crossing. A relay server stores each alert and sends it to the
control rooms. In a control room, an operator acknowledges the alarm, and the
monitor shows who acknowledged it.

| Monitor                                                               | Control room                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| ![The monitor with live chart and alert log](docs/images/monitor.png) | ![The control room with an acknowledged alarm](docs/images/control.png) |

## Status

All milestones (M0 to M7) are done. Refer to [docs/roadmap.md](docs/roadmap.md)
for the plan, [docs/architecture.md](docs/architecture.md) for the design and
its limits, and [docs/adr](docs/adr) for the main decisions.

## Quick start

You need Node 24 and pnpm 11. Corepack installs the correct pnpm version from
`package.json`.

```sh
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` starts three processes:

| Process      | URL                            | Note                                              |
| ------------ | ------------------------------ | ------------------------------------------------- |
| Monitor      | http://localhost:5173/         | Vite dev server; it sends `/ws` to the relay      |
| Control room | http://localhost:5174/control/ | Vite dev server; it sends `/ws` to the relay      |
| Relay        | http://localhost:8080/         | Development mode: it accepts the two Vite origins |

## Two-minute demo

1. Open the control room. Type your name in "Operator name" and click **Save**.
2. Open the monitor at http://localhost:5173/?rate=10&seed=7. The badge shows
   "Connected".
3. Wait for a crossing. The alert log shows "Accepted", and the alarm appears
   in the control room.
4. In the control room, click **Acknowledge**. The monitor shows
   "Acknowledged by" and your name.
5. Restart the relay: in a second terminal, run `touch server/src/index.ts`.
   The relay restarts, and both badges show "Reconnecting", then "Connected".
   Alerts from the monitor wait in its outbox and then go to the relay.

The monitor reads two optional URL parameters: `rate` (1, 2, 5 or 10 readings
each second) and `seed` (an integer for the random data).

## Production build

```sh
pnpm build
pnpm start
```

One process serves everything on one port, with no CORS:

| Path        | Content                         |
| ----------- | ------------------------------- |
| `/`         | The monitor                     |
| `/control/` | The control room                |
| `/ws`       | The WebSocket relay             |
| `/healthz`  | Health check: `{"status":"ok"}` |

All settings are optional environment variables. Refer to
[.env.example](.env.example).

| Variable          | Default      | Purpose                                                                |
| ----------------- | ------------ | ---------------------------------------------------------------------- |
| `PORT`            | `8080`       | HTTP and WebSocket port                                                |
| `NODE_ENV`        | `production` | `production` accepts WebSockets from the same origin only              |
| `ALLOWED_ORIGINS` | (empty)      | A comma-separated list of origins; it replaces the default origin rule |
| `STATIC_DIR`      | `apps/`      | The folder that contains `monitor/dist` and `control/dist`             |
| `RECENT_LIMIT`    | `500`        | The number of alerts that the relay keeps in memory                    |
| `LOG_LEVEL`       | `info`       | `debug`, `info`, `warn` or `error`; the relay writes JSON lines        |

## Docker

```sh
docker compose up --build
```

The image (`node:24-alpine`, approximately 250 MB) contains the server bundle,
its three production dependencies and both built apps. The server runs as the
`node` user. A health check calls `/healthz` every 15 seconds. On `docker
compose stop`, the relay closes each client connection with code 1001, and
the clients reconnect when it starts again.

## Architecture

```
 apps/monitor  ──alert──▶  server (relay)  ──alert──▶  apps/control
 (browser)     ◀accepted─  /ws, in-memory  ◀───ack───  (browser)
               ◀──────────── acknowledged ────────────▶
                         packages/protocol
              (shared zod schemas for every message)
```

| Part                | What it does                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/protocol` | The message schemas (zod), their types, and parse functions that do not throw                     |
| `apps/monitor`      | Random-walk data, live chart, crossing detector with hysteresis, outbox, WebSocket transport      |
| `server`            | Native `ws` relay: validation, dedupe, routing, rate limit, heartbeat, static files, health check |
| `apps/control`      | Alarm list, operator name, acknowledgements                                                       |

The relay does no domain logic. It checks each message against the schema and
the sender's role, stores alerts, and sends each message to the correct clients.

### Messages

Each client sends `hello` first, with its role (`monitor` or `control`). The
relay answers with `welcome`, which contains up to 100 recent alerts.

| From         | Message        | To                        |
| ------------ | -------------- | ------------------------- |
| Monitor      | `alert`        | Relay                     |
| Relay        | `accepted`     | The monitor that sent it  |
| Relay        | `alert`        | All control rooms         |
| Control room | `ack`          | Relay                     |
| Relay        | `acknowledged` | All clients               |
| Relay        | `error`        | The client that caused it |

Close codes: 4001 (no valid `hello`), 4002 (unsupported protocol version; the
clients do not reconnect), 4008 (rate limit), 1001 (relay shutdown).

### Detection

The monitor uses a Schmitt trigger. The band is threshold ± hysteresis / 2.
An alert occurs only when a reading leaves the band on the other side. The
first reading never causes an alert, and a change of the settings never causes
an alert.

### Delivery

Delivery is at least once, and the relay removes duplicates by alert id:

1. The monitor puts each alert in an outbox (maximum 50; the oldest is dropped
   and shown as "Dropped").
2. After `welcome`, the monitor sends the outbox in order. Each alert waits for
   `accepted` for 5 seconds.
3. After a timeout or a disconnect, the alert goes back into the queue and the
   monitor sends it again with the same id.
4. The relay answers a repeated alert with `accepted` and `duplicate: true`. It
   does not send it to the control rooms again.
5. After a reconnect, the monitor compares `welcome.recent` with its outbox, so
   it does not send alerts that the relay already has.

Reconnect delay: `min(30 s, 500 ms × 2^n) × (0.5 + random × 0.5)`.

## Project layout

```
apps/
  monitor/       React 19, Redux Toolkit, Recharts, Vite
  control/       React 19, useReducer, Vite (served under /control/)
server/          Node 24, ws, sirv, bundled with tsup
packages/
  protocol/      zod schemas, shared by all three
e2e/             Playwright test against the production build
docs/
  architecture.md  parts, state, message flow, scaling limits
  adr/             architecture decision records 0001 to 0005
  roadmap.md       milestones, decisions, next steps
Dockerfile, docker-compose.yml
```

## Tests

```sh
pnpm test          # unit and integration tests, all packages
pnpm test:e2e      # production build, then Playwright in Chromium
pnpm typecheck
pnpm lint
pnpm format:check
```

Before the first `pnpm test:e2e`, install the browser once:
`pnpm --filter @app/e2e exec playwright install chromium`.

CI runs all of these commands and `pnpm build` on each push. A second CI job
builds the Docker image and waits until the container reports healthy.

| Package             | Tests | What they cover                                                                                                             |
| ------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/monitor`      | 203   | Detector (with fast-check properties), outbox, backoff, transport contract on a fake relay, components, accessibility (axe) |
| `server`            | 63    | Routing rules, relay on real sockets, configuration, HTTP, and one test of the monitor transport against the real relay     |
| `packages/protocol` | 41    | Each message schema, valid and invalid                                                                                      |
| `apps/control`      | 30    | Alarm list rules, connection, operator name, Acknowledge flow, accessibility (axe)                                          |
| `e2e`               | 1     | The full flow on the production build: operator, alert, Acknowledge, "Acknowledged by", no duplicate rows                   |

## Decisions and changes from the specification

The ADRs record the main decisions:

- [0001](docs/adr/0001-native-websocket-relay.md): a native WebSocket relay, no Socket.IO
- [0002](docs/adr/0002-shared-protocol-package.md): one shared protocol package with runtime validation
- [0003](docs/adr/0003-crossing-detection-with-hysteresis.md): edge-triggered crossing detection with hysteresis
- [0004](docs/adr/0004-at-least-once-delivery.md): at-least-once delivery with server-side dedupe
- [0005](docs/adr/0005-relay-security-defaults.md): relay security defaults

The main changes from the specification are:

- Node 24 (the current LTS) in place of Node 22.
- A rate limit of 60 messages (refill 10 each second) in place of 20. A monitor
  can send its full outbox of 50 alerts at once after a reconnect.
- The apps share the protocol package, but not their connection code. Each app
  has its own small copy of the backoff function.

## Limits and next steps

- The relay keeps alerts in memory only. A restart deletes them. The
  `AlertStore` interface is the place for a database, for example SQLite.
- There is no authentication. Anyone who can open the page can acknowledge.
- One relay process only; there is no horizontal scaling.
- The monitor bundle is approximately 200 KB gzipped, mostly Recharts. A
  dynamic `import()` of the chart would make the first load smaller.

Refer to the scaling section in [docs/architecture.md](docs/architecture.md)
for the changes that each limit needs.
