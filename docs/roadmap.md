# Roadmap

The project was built in eight milestones. Each milestone ended with one commit,
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
| M8        | Login with sessions for both apps, SQLite for users, sessions and alerts                                                     | Done   | branch `feat/auth`   |

## Decisions

The ADRs and the README use these decisions.

### Platform and tooling

- **Node 24** (current LTS) instead of the spec's Node 22.
- **TypeScript 6.0**: typescript-eslint does not support 7.x yet.
- **pnpm 11** with its default supply-chain policies kept: dependency build scripts
  allowed only for esbuild; no exemptions from the minimum release age (Playwright
  pinned to 1.63.0 because 1.64.1 was too new).
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

## Out of scope

User management page, single sign-on (OIDC), horizontal scaling,
high and low thresholds, multiple data sources, Turborepo, canvas charts for high
rates.
