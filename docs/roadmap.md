# Roadmap

The project was built in nine milestones. Each milestone ended with one commit,
and with typecheck, lint, format and tests green.

## Status

| Milestone | Scope                                                                                                                        | Status | Commit               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------- |
| M0        | Workspace skeleton: pnpm workspace, strict TS, ESLint, Prettier, Vitest, CI                                                  | Done   | `b387c20`            |
| M1        | `@app/protocol`: zod schemas, types, non-throwing parse helpers                                                              | Done   | `c9ef0dc`            |
| M2        | Monitor domain: crossing detector (+ property tests), random walk, ring buffer, chart data, threshold input, backoff, outbox | Done   | `1345bcf`            |
| M3        | Monitor UI with an in-memory transport, Redux, persistence, hooks, components                                                | Done   | `a912d2c`, `914358b` |
| M4        | Relay server: validation, dedupe, routing, rate limit, heartbeat, static files, shutdown                                     | Done   | `3d2c023`            |
| M5        | Monitor WebSocket transport + contract tests                                                                                 | Done   | `0ca55f9`            |
| M6        | Control room app                                                                                                             | Done   | `5955cb6`            |
| M7        | Packaging and docs: Docker, e2e, README, ADRs, architecture                                                                  | Done   | `33c8823`            |
| M8        | Login with sessions for both apps, SQLite for users, sessions and alerts                                                     | Done   | `e64a52e`–`2b3bcda`  |
| M9        | Sensor agent: readings, detection and alerts move to a service; the monitor becomes a live view with shared settings         | Done   | `897e5f1`–`4309c93`  |

## Decisions

The ADRs and the README use these decisions.

### Platform and tooling

- **Node 24** (current LTS) instead of the spec's Node 22.
- **TypeScript 6.0**: typescript-eslint does not support 7.x yet.
- **pnpm 11** with its default supply-chain policies kept: dependency build scripts
  allowed only for esbuild; no exemptions from the minimum release age (Playwright
  was pinned to 1.63.0 because 1.64.1 was too new; now 1.64.0). Dependabot
  waits 7 days for a new version, and ignores major updates of Node and
  `@types/node`, which follow the Node 24 LTS version.
- **Server bundled with tsup**, `@app/protocol` inlined (`noExternal`), so the
  source-only protocol package never needs a build step.
- Additions to the dependency list of the specification:
  `@testing-library/jest-dom`; `axe-core` used directly because `vitest-axe` is
  unmaintained.

### Protocol (M1)

- `hello.v` accepts any positive integer so the server can answer
  `UNSUPPORTED_VERSION` instead of a generic `BAD_MESSAGE`.
- Unknown fields are stripped, not rejected (forward compatible).
- zod 4's `z.number()` already rejects NaN/Infinity; timestamps must be UTC.

### Detection (M2, M3) — ADR 0003

- Edge-triggered Schmitt trigger: band `[T − h/2, T + h/2]`, strict comparisons,
  first reading never alerts, non-finite readings ignored.
- A settings change never raises an alert. The detector is re-classified against
  T at the start of the next reading (not in an effect), so no reading can be judged
  against a new threshold with a stale side.
- Five fast-check properties, including "hysteresis never produces more events than
  a plain detector" (proof sketch in the test).

### Monitor architecture (M3)

- Composition root in `main.tsx`: long-lived objects created once, passed as props.
- `useThresholdMonitor` is the only data-source subscriber; it reads the latest
  config through `useEffectEvent` (no stale closure, no resubscribe).
- Transport lifetime owned by `useTransport`, kept in a ref (lint forbids state
  set in effects); StrictMode never has two transports alive.
- Live readings bypass Redux: ring buffer + `useSyncExternalStore`, so only the chart
  and the readout re-render per reading.
- Redux holds threshold settings (persisted, zod-validated, safe fallbacks), alerts
  (entity adapter, capped at 200, status never moves backwards) and connection status.
- Chart window is a reading count (120), so its duration depends on the rate; the UI
  states the span.
- Alert latency uses only the browser clock (event time to local receipt of
  `accepted`), so client/server clock skew cannot distort it.

### Delivery (M2, M5) — ADR 0004

- At-least-once with server-side dedupe by alert id.
- Outbox: capacity applies to the queue (oldest dropped and reported); pending alerts
  return to the queue on timeout (5 s) or disconnect, merged back in creation order.
- Reconnect backoff: `min(30 s, 500 ms · 2^n) · (0.5 + random · 0.5)` (equal jitter).

### Relay (M4) — ADRs 0001, 0005

- Native WebSocket (`ws`), no Socket.IO.
- Production is the default mode (same-origin only); `pnpm dev` loads
  `server/.env.development` to allow the Vite origins. Missing `Origin` is allowed
  (non-browser clients can forge it anyway).
- Rate limit capacity 60 (spec: 20) so an outbox flush of up to 50 alerts is not
  rejected; 10 tokens/s refill.
- Routing rules are pure (`routing.ts`) and tested without sockets.
- In-memory `AlertStore` behind an interface: the seam for SQLite later.
- Upgrade sockets get their own error listener (regression: an ECONNRESET after a
  403 used to crash the server).

### Transport (M5) — ADR 0004

- `websocketTransport.ts` takes a socket factory (`open`/`message`/`close`
  events, `send`/`close` methods) instead of the WebSocket constructor, so the
  same file runs on a fake socket in jsdom and on Node's built-in WebSocket
  against the real relay. The URL comes from `relayUrl(window.location)` in
  `main.tsx`; the transport never reads globals.
- Status is `connecting` during every attempt and `reconnecting` (attempt, retryAt)
  while it waits; the attempt count resets on `welcome`. Close code 4002 is final.
- `welcome.recent` reconciliation emits `accepted` (and `acknowledged`, if an
  operator acknowledged while this tab was offline) for every record with this
  tab's `sourceId`; the store ignores ids it does not hold or that would move back.
- Timeouts and disconnects report `queued` again for the alerts they put back.
- The fake relay delivers events as microtasks, not timers: a round trip takes no
  fake time, so the contract suite counts deadlines and backoff delays exactly.
- The real-relay integration test lives in the server package
  (`monitorTransport.integration.test.ts`): it needs Node types and the relay
  source, which the monitor's DOM-only tsconfig does not have.
- `inMemoryTransport.ts` was no longer used by the app and was removed in M7.

### Control room (M6)

- One pure `alarmsReducer` (`state/alarms.ts`) behind `useReducer`. Beyond the
  planned `welcomed`, `alertReceived`, `acknowledged` and `cleared`, it has
  `ackSent`, `ackFailed` and `disconnected`, so the Acknowledge button cannot be
  pressed twice and is free again if the ack is lost or refused.
- `cleared` removes acknowledged alarms from the list (the "Clear acknowledged"
  button). The list is newest first by `receivedAt`, unique by id, capped at 500.
- Every action is idempotent: a reconnect replays `recent`, and an acknowledged
  copy always wins over an older unacknowledged one; the first acknowledgement wins.
- `connection/relayConnection.ts` repeats the monitor's backoff and socket
  factory (share the contract, not the logic); `useRelay` owns its lifetime the
  way `useTransport` does. The connection badge and the style tokens are copies too.
- Acknowledge needs a saved operator name (1–40 characters, trimmed, kept in
  localStorage and validated on load) and an open connection.
- Relay errors with a `ref` end the pending ack; the message is shown in a
  `role="alert"` notice.

### Packaging and docs (M7)

- Docker: two stages on `node:24-alpine`. `pnpm deploy --prod --legacy` gives
  the server's production dependencies only (sirv, ws, zod); `--legacy` is
  enough because no workspace package is needed at run time (protocol is
  bundled). Files are owned by root, the process runs as `node`. The health
  check uses Node's `fetch`, so the image needs no curl or wget.
- `docker-compose.yml` runs the container read-only, with all capabilities
  dropped and `no-new-privileges`: the relay only reads files.
- The Playwright test is its own workspace package (`e2e/`), so it has its own
  tsconfig and lint setup. It runs against `server/dist` on port 8090, the way
  production runs, with two browser contexts (operator and monitor).
- CI: actions updated to checkout v7, setup-node v7, pnpm/action-setup v6,
  upload-artifact v7 (all run on Node 24). The check job adds the Playwright
  run; a second job builds the image and waits for "healthy".
- README uses two screenshots in `docs/images/` in place of a GIF.
- Final pass: `inMemoryTransport.ts` removed (unused since M5). `relay.ts`
  stays one file: the rules already live in `routing.ts`, and what remains is
  one socket lifecycle. Recharts code splitting is listed as a next step, not
  done. Buttons use a new `--on-accent` token: dark text on the light
  dark-mode blue, because white text on it had low contrast.

### Login and storage (M8) — ADRs 0006, 0007

- One login page at `/login`, made by the relay, for both apps. Users have the
  roles `operator` and `monitor`.
- Server sessions: a random token in an `HttpOnly`, `SameSite=Strict` cookie;
  the database keeps only its SHA-256. The WebSocket upgrade uses the same
  cookie. No session, a wrong role or a logout closes the socket with 4003.
- Protocol version 2: `ack` has no `operator`; the relay takes the display
  name from the session and records the user id.
- SQLite through `node:sqlite` (no new dependency). `createSqliteAlertStore`
  implements `AlertStore`; `RECENT_LIMIT` is removed.
- The control room lost its operator name form. Both apps show the user and a
  **Log out** button.
- Review fixes after M8: `safeNext` refuses control characters and uses the
  URL parser (a TAB made an open redirect); the relay checks each session on
  every heartbeat, so an expired session loses its sockets within 15 s.
- Demo user `demo` with both roles: one browser has one cookie for
  `localhost`, so one login must open both apps.

### Tables (after M8) — ADR 0008

- The alarm table did not keep its layout after an acknowledgement: the chip
  was lower than the button. Fixed layout and a fixed cell height fix this; the
  e2e test checks that widths and heights stay the same.
- Both long tables scroll in a box with a sticky header row, and the headings
  show the count.
- New package `@app/ui` with a generic `DataTable<T>`: each app gives column
  definitions with a `cell` render function. The rule "share the contract, not
  the logic" now also allows generic UI parts.

### Hidden tabs

- Browsers slow timers in hidden tabs (1 tick each second, later 1 each
  minute), so the temperature looked stuck. The random-walk source now takes
  the due readings from the clock, each with its scheduled time, and makes up
  at most the last minute (`MAX_CATCH_UP_MS`). A pause or a rate change starts
  a new schedule and is never made up.
- One screen: on a window at least 721 px wide and 800 px high, the monitor
  page is `100dvh`. The chart row keeps the height of the settings, and the
  alert log fills the rest and scrolls. Smaller windows scroll the page.
- The control room table fills the window under the header (from 560 px
  window height), so it shows as many alarms as fit.

### Sensor agent (M9) — ADR 0009

- A new Node service, `sensor/`, makes the readings, finds the crossings and
  sends the alerts. The random walk, the detector, the outbox, the backoff and
  the transport moved from `apps/monitor` with `git mv`, with their tests.
  `agent.ts` is the old `useThresholdMonitor` loop without React.
- The sensor has no session. Its `hello` carries `SENSOR_TOKEN`, and the relay
  checks it in constant time. One sensor at a time; a different sensor id gets 4005,
  and the same id replaces its old connection.
- Protocol version 3: `reading`, `settingsApplied`, `setSettings`, `settings`
  and `sensorStatus`. `welcome` has the settings, the sensor and the last 120
  readings (monitors only).
- Readings are at most once and in memory only. Alerts stay at least once.
- Shared settings in SQLite (migration 2), with the name of the user who
  changed them. The sensor's defaults are stored only when nothing is stored.
  The monitor form shows a change from another tab, unless the user is
  editing it.
- The sensor has its own rate limit bucket: capacity 600, refill 50 each
  second.
- The monitor lost its data source, detector, outbox, `?rate` and `?seed`,
  the pause button and `localStorage` persistence. A new sensor panel shows
  the rate, the chart span and who changed the settings last.
- Packaging: the sensor bundle includes `zod` and `@app/protocol`, so it is
  one file. The Docker image contains it, and Compose starts it as a second
  container from the same image. Both containers read `SENSOR_TOKEN` from
  `.env`.
- The e2e test starts the relay and the sensor (`e2e/start-backend.mjs`). A
  new test checks that two monitor tabs show the same reading and share a
  threshold change. `DataTable` rows have a `data-key`, so the test finds a
  row again after live updates.
- Login rate limit: each try takes a token before the password check, and a
  correct login gives it back. Thus, parallel tries cannot bypass the limit,
  and a user who types the correct password is not limited.
- Review fixes after M9: the relay clears the readings when the sensor goes;
  `welcome` and a sensor connect send the settings of the connected sensor;
  the sensor's `welcome` has its own recent alerts. The monitor slider sends
  its value on release, and a second settings change starts from the first.
  The sensor drains its outbox for up to 3 s on SIGTERM.
- Release checks: the CI Docker job starts `docker-compose.yml` and waits for
  "sensor online". A new e2e file measures the Core Web Vitals (LCP, CLS,
  INP) with a 4x CPU slowdown and checks the "good" limits.

### Hardening (after M9)

A gap analysis against bulletproof-react and a backend checklist gave
these changes:

- Error boundaries (`ErrorBoundary` in `@app/ui`) around the chart, the
  readout and each table.
- A strict CSP, `nosniff` and `referrer-policy` on the app pages. Hashed
  assets are `immutable` for a year; `index.html` is `no-cache`.
- Backpressure: a client with more than 1 MiB in its send buffer skips
  readings (at most once anyway) and still gets each alert.
- The monitor loads the chart with `React.lazy`: the first JavaScript is
  113 kB gzipped in place of 206 kB.
- Import boundaries with `@typescript-eslint/no-restricted-imports` (no new
  plugin). Type imports are allowed.
- `pnpm audit` in CI (no finding in production dependencies, none of high
  severity in the tools) and Dependabot with a 7-day cooldown.
- `/readyz`, and a JSON log line before the process stops on an uncaught
  exception or an unhandled rejection.
- Not done, on purpose: React Query, React Router, React Hook Form, MSW,
  feature folders, Storybook and kebab-case file names. They solve problems
  that this app does not have.

### Review fixes (after the hardening)

- The login limit can use `X-Forwarded-For` behind one trusted proxy
  (`TRUST_PROXY`); only the last entry, which the proxy adds, counts.
- The relay refuses an alert whose `sourceId` is not the sensor's id.
- `/healthz` and `/readyz` accept only `GET` and `HEAD` (`405` otherwise).
- `@app/client` replaces about 350 copied lines in the two apps (ADR 0010).
- Both message switches end with a `never` check, so a new message type is a
  build error.
- `ErrorBoundary` has its own CSS; each app has a root boundary and shows
  "Checking your session…" until the session check ends.
- `docker compose up --build` needs no setup: the relay makes the sensor
  token in the data volume on its first start (`SENSOR_TOKEN_FILE`), and the
  sensor reads it from a read-only mount. `DEMO_USERS` comes from the shell.

## Out of scope

User management page, single sign-on (OIDC), horizontal scaling,
high and low thresholds, more than one sensor, Turborepo, canvas charts for high
rates.
