# Threshold Monitor

[![CI](https://github.com/krisshkodrani/threshold-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/krisshkodrani/threshold-monitor/actions/workflows/ci.yml)

A monitor app reads a value, finds the crossings of a threshold and sends an
alert for each crossing. A relay server stores each alert and sends it to the
control rooms. In a control room, an operator acknowledges the alarm, and the
monitor shows who acknowledged it. Users log in, and the relay keeps users,
sessions and alerts in SQLite.

| Monitor                                                               | Control room                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| ![The monitor with live chart and alert log](docs/images/monitor.png) | ![The control room with an acknowledged alarm](docs/images/control.png) |

## Status

All milestones (M0 to M8) are done. M8 added login and SQLite storage. Refer to [docs/roadmap.md](docs/roadmap.md)
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

In development, the relay adds three demo users (`DEMO_USERS=true` in
`server/.env.development`). The password of each is `demo`.

| Username   | Role       | Can open         |
| ---------- | ---------- | ---------------- |
| `operator` | `operator` | The control room |
| `monitor`  | `monitor`  | The monitor      |
| `demo`     | both       | Both apps        |

The database is in `data/threshold-monitor.db`. To start again with no data,
stop `pnpm dev` and delete the `data` folder.

## Two-minute demo

1. Open the control room. The login page opens. Log in as `demo` with the
   password `demo`.
2. In a new tab of the same browser, open the monitor at
   http://localhost:5173/?rate=10&seed=7. You do not log in again, because
   the session cookie is for `localhost`. The badge shows "Connected".
3. Wait for a crossing. The alert log shows "Accepted", and the alarm appears
   in the control room.
4. In the control room, click **Acknowledge**. The monitor shows
   "Acknowledged by Demo User". The name comes from the session.
5. Restart the relay: in a second terminal, run `touch server/src/index.ts`.
   The relay restarts, and both badges show "Reconnecting", then "Connected".
   Alerts from the monitor wait in its outbox and then go to the relay. The
   alarms and acknowledgements are still there, because they are in SQLite.
6. Click **Log out**. The page goes back to the login page.

The two apps share one cookie on `localhost`, so a second login in the same
browser replaces the first. To test with `operator` and `monitor` (one role
each), use two browsers or a private window for the second user. Log in to
the control room as `monitor` to see the role check.

The monitor reads two optional URL parameters: `rate` (1, 2, 5 or 10 readings
each second) and `seed` (an integer for the random data).

Browsers slow the timers of a hidden tab. The data source therefore takes the
number of due readings from the clock, not from the timer: when the tab is
visible again, it makes the missed readings with their own times, so the data
has no gap and the crossings in that time are still sent. After more than one
minute hidden, only the last minute is made up.

## Production build

```sh
pnpm build
pnpm start
```

One process serves everything on one port, with no CORS:

| Path           | Content                                    |
| -------------- | ------------------------------------------ |
| `/`            | The monitor                                |
| `/control/`    | The control room                           |
| `/login`       | The login page (one for both apps)         |
| `/api/login`   | `POST`: check the password, set the cookie |
| `/api/logout`  | `POST`: end the session, close its sockets |
| `/api/session` | `GET`: the signed-in user, or `401`        |
| `/ws`          | The WebSocket relay (needs a session)      |
| `/healthz`     | Health check: `{"status":"ok"}`            |

## Users

Production has no users at first. Add each user with the CLI. The password
comes from stdin, so it is not in the shell history:

```sh
pnpm build
echo 'a-long-password' | pnpm --filter @app/server user:add kris --name "Kris" --roles operator,monitor
```

Usernames use `a-z`, `0-9`, `.`, `_` and `-`. The display name (1 to 40
characters) is the name in "Acknowledged by". Passwords need at least 8
characters. The roles are `operator` (control room) and `monitor`.

All settings are optional environment variables. Refer to
[.env.example](.env.example).

| Variable            | Default                     | Purpose                                                                         |
| ------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| `PORT`              | `8080`                      | HTTP and WebSocket port                                                         |
| `NODE_ENV`          | `production`                | `production` accepts WebSockets from the same origin only                       |
| `ALLOWED_ORIGINS`   | (empty)                     | A comma-separated list of origins; it replaces the default origin rule          |
| `STATIC_DIR`        | `apps/`                     | The folder that contains `monitor/dist` and `control/dist`                      |
| `LOG_LEVEL`         | `info`                      | `debug`, `info`, `warn` or `error`; the relay writes JSON lines                 |
| `DATABASE_PATH`     | `data/threshold-monitor.db` | The SQLite file for users, sessions and alerts                                  |
| `SESSION_TTL_HOURS` | `12`                        | How long a login lasts                                                          |
| `COOKIE_SECURE`     | `false`                     | Set `true` when the app runs behind HTTPS                                       |
| `DEMO_USERS`        | `false`                     | `true` adds the demo users `operator`, `monitor` and `demo`; not for production |

## Docker

```sh
docker compose up --build
```

The image (`node:24-alpine`, approximately 250 MB) contains the server bundle,
its three production dependencies and both built apps. The server runs as the
`node` user. A health check calls `/healthz` every 15 seconds. On `docker
compose stop`, the relay closes each client connection with code 1001, and
the clients reconnect when it starts again.

The database is in the volume `data` (`/app/data`). The rest of the container
filesystem is read-only. Add a user:

```sh
echo 'a-long-password' | docker compose exec -T relay \
  node dist/cli.js user:add kris --name "Kris" --roles operator,monitor
```

For a quick local demo, set `DEMO_USERS: "true"` in `docker-compose.yml`.

## Architecture

```
 apps/monitor  ──alert──▶  server (relay)  ──alert──▶  apps/control
 (browser)     ◀accepted─  /ws, in-memory  ◀───ack───  (browser)
               ◀──────────── acknowledged ────────────▶
                         packages/protocol
              (shared zod schemas for every message)
```

| Part                | What it does                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/protocol` | The message schemas (zod), their types, and parse functions that do not throw                                |
| `packages/ui`       | `DataTable<T>`: a generic table with column definitions, a scroll box and a sticky header (both apps)        |
| `apps/monitor`      | Random-walk data, live chart, crossing detector with hysteresis, outbox, WebSocket transport                 |
| `server`            | Native `ws` relay: login, sessions, SQLite, validation, dedupe, routing, rate limit, heartbeat, static files |
| `apps/control`      | Alarm list, acknowledgements                                                                                 |

The relay does no domain logic. It checks the session, checks each message
against the schema and the sender's role, stores alerts, and sends each
message to the correct clients.

### Messages

The browser sends the session cookie with the WebSocket upgrade. Each client
sends `hello` first, with its role (`monitor` or `control`). The role must be
one of the user's roles. The relay answers with `welcome`, which contains up
to 100 recent alerts. The protocol version is 2: `ack` contains only the alert
id, and the relay adds the operator name from the session.

| From         | Message        | To                        |
| ------------ | -------------- | ------------------------- |
| Monitor      | `alert`        | Relay                     |
| Relay        | `accepted`     | The monitor that sent it  |
| Relay        | `alert`        | All control rooms         |
| Control room | `ack`          | Relay                     |
| Relay        | `acknowledged` | All clients               |
| Relay        | `error`        | The client that caused it |

Close codes: 4001 (no valid `hello`), 4002 (unsupported protocol version; the
clients do not reconnect), 4003 (no session, wrong role or logout; the clients
go to the login page), 4008 (rate limit), 1001 (relay shutdown).

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
server/          Node 24, ws, sirv, node:sqlite, bundled with tsup
packages/
  protocol/      zod schemas, shared by all three
  ui/            DataTable, shared by the two apps
e2e/             Playwright test against the production build
docs/
  architecture.md  parts, state, message flow, scaling limits
  adr/             architecture decision records 0001 to 0008
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

| Package             | Tests | What they cover                                                                                                                                                                         |
| ------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/monitor`      | 210   | Detector (with fast-check properties), outbox, backoff, transport contract on a fake relay, components, accessibility (axe)                                                             |
| `server`            | 120   | Routing rules, relay on real sockets, sessions and roles, login routes, passwords, both alert stores, configuration, HTTP, and one test of the monitor transport against the real relay |
| `packages/protocol` | 40    | Each message schema, valid and invalid                                                                                                                                                  |
| `packages/ui`       | 5     | DataTable: rows and cells from the columns, widths, classes, tooltips, the named scroll region, the empty state, accessibility (axe)                                                    |
| `apps/control`      | 27    | Alarm list rules, connection, account bar, Acknowledge flow, accessibility (axe)                                                                                                        |
| `e2e`               | 3     | The full flow on the production build: login, alert, Acknowledge, "Acknowledged by", no duplicate rows, logout; a wrong role; a wrong password                                          |

## Decisions and changes from the specification

The ADRs record the main decisions:

- [0001](docs/adr/0001-native-websocket-relay.md): a native WebSocket relay, no Socket.IO
- [0002](docs/adr/0002-shared-protocol-package.md): one shared protocol package with runtime validation
- [0003](docs/adr/0003-crossing-detection-with-hysteresis.md): edge-triggered crossing detection with hysteresis
- [0004](docs/adr/0004-at-least-once-delivery.md): at-least-once delivery with server-side dedupe
- [0005](docs/adr/0005-relay-security-defaults.md): relay security defaults
- [0006](docs/adr/0006-login-with-sessions.md): login with server sessions
- [0007](docs/adr/0007-sqlite-storage.md): SQLite for users, sessions and alerts
- [0008](docs/adr/0008-shared-ui-package.md): a shared UI package for the data table

The main changes from the specification are:

- Node 24 (the current LTS) in place of Node 22.
- A rate limit of 60 messages (refill 10 each second) in place of 20. A monitor
  can send its full outbox of 50 alerts at once after a reconnect.
- The apps share the protocol package and the generic `DataTable` (`@app/ui`,
  ADR 0008), but not their connection code. Each app has its own small copy of
  the backoff function.

## Limits and next steps

- One relay process with a local SQLite file; there is no horizontal scaling.
- Users are added with the CLI only. There is no admin page and no password
  change. Single sign-on (OIDC) can use the same session cookie later.
- If the session ends while the monitor is offline, the alerts in its outbox
  are lost when the page goes to the login page. The outbox is in memory only.
- The `alerts` table grows without a limit; a retention job is a next step.
- The app has no TLS. Use a reverse proxy for HTTPS and set `COOKIE_SECURE`.
- The monitor bundle is approximately 200 KB gzipped, mostly Recharts. A
  dynamic `import()` of the chart would make the first load smaller.

Refer to the scaling section in [docs/architecture.md](docs/architecture.md)
for the changes that each limit needs.
