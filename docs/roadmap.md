# Roadmap

Working plan for the take-home, built milestone by milestone. Each milestone ends
with typecheck, lint, format and tests green, one focused commit, and a review stop.
Time budget: 2 days. If time runs short, stop after M5 with a minimal log page
instead of the full control room: M2 and M3 quality matters more than M6.

## Status

| Milestone | Scope                                                                                                                        | Status  | Commit               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------- |
| M0        | Workspace skeleton: pnpm workspace, strict TS, ESLint, Prettier, Vitest, CI                                                  | Done    | `b387c20`            |
| M1        | `@app/protocol`: zod schemas, types, non-throwing parse helpers                                                              | Done    | `c9ef0dc`            |
| M2        | Monitor domain: crossing detector (+ property tests), random walk, ring buffer, chart data, threshold input, backoff, outbox | Done    | `1345bcf`            |
| M3        | Monitor UI with an in-memory transport, Redux, persistence, hooks, components                                                | Done    | `a912d2c`, `914358b` |
| M4        | Relay server: validation, dedupe, routing, rate limit, heartbeat, static files, shutdown                                     | Done    | `3d2c023`            |
| M5        | Monitor WebSocket transport + contract tests                                                                                 | Next    |                      |
| M6        | Control room app                                                                                                             | Planned |                      |
| M7        | Packaging and docs: Docker, e2e, README, ADRs, architecture                                                                  | Planned |                      |

## Decisions so far

These feed the ADRs and the README in M7.

### Platform and tooling

- **Node 24** (current LTS) instead of the spec's Node 22.
- **TypeScript 6.0**: typescript-eslint does not support 7.x yet.
- **pnpm 11** with its default supply-chain policies kept: dependency build scripts
  allowed only for esbuild; no exemptions from the minimum release age (Playwright
  pinned to 1.63.0 because 1.64.1 was too new).
- **Server bundled with tsup**, `@app/protocol` inlined (`noExternal`), so the
  source-only protocol package never needs a build step.
- Approved additions beyond the spec list: `@testing-library/jest-dom`; `axe-core`
  used directly because `vitest-axe` is unmaintained.

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

## Next: M5 — WebSocket transport

Goal: the monitor talks to the real relay and survives server restarts.

- `transport/websocketTransport.ts` implementing `AlertTransport`:
  relative `/ws` URL (ws/wss from the page protocol), `hello` → wait for `welcome`
  → flush the outbox in order; reconcile `welcome.recent` for this tab's `sourceId`
  (emit `accepted`/`acknowledged`, remove from the outbox); `accepted` →
  `outbox.accept`; one timer for the next pending deadline (`nextDeadline`);
  socket close → `requeueAll`, status `reconnecting` with `backoffDelay`; attempt
  reset after `welcome`; no reconnect after `dispose()` or close code 4002;
  invalid server messages ignored and logged.
- WebSocket constructor, scheduler, clock and random injected, so the contract suite
  can run on a fake socket with fake timers (real sockets and fake timers do not mix).
- `transport.contract.ts`: `runTransportContract(makeTransport, makeServer)` with the
  cases from spec §8.4 (delivery, queued while offline then in order, lost `accepted`
  → resend → one record, overflow drops oldest, backoff bounds, dispose stops
  everything, `acknowledged` surfaced). Plus one integration test against the real
  relay with real timers.
- Wire into `main.tsx` (in-memory transport kept for tests); restart `pnpm dev` so the
  server runs in development mode.
- Done when: the monitor shows `accepted` against the dev server and recovers after a
  server restart, with queued alerts delivered exactly once.

## M6 — Control room

- `useReducer` with a pure, tested reducer: `welcomed`, `alertReceived`,
  `acknowledged`, `cleared`; dedupe by id; newest first; cap 500.
- Connection hook with the same reconnect behaviour (small duplicated backoff,
  documented: share the contract, not the logic).
- Operator name (persisted, required before acknowledging), alarm list with
  Acknowledge or "Acknowledged by X at HH:MM:SS", unacknowledged count in the header,
  connection badge. "Unacknowledged only" filter if time allows.
- Tests: reducer; Acknowledge disabled without an operator name; clicking sends `ack`;
  axe check.
- Done when acknowledging in the control room shows `acknowledged by <name>` in the
  monitor.

## M7 — Packaging and docs

- Multi-stage Dockerfile (node:24-alpine, non-root, `pnpm deploy --prod`,
  HEALTHCHECK on `/healthz`), `docker-compose.yml`, `.dockerignore`.
- One Playwright spec against the production build: set operator → alarm appears →
  monitor shows `accepted` → acknowledge → monitor shows `acknowledged by <name>` →
  no duplicate rows.
- CI: add Playwright and `docker build`; update GitHub Actions to current major
  versions (Node 20 deprecation notice).
- README (summary + GIF placeholder, quick start, two-minute demo, architecture,
  decisions, testing strategy, spec interpretation, scaling, next steps), ADRs
  0001–0005, `docs/architecture.md` with the scaling section.
- Final pass: remove dead code; every file explainable. Known candidates:
  split `server/src/relay.ts` (280 lines) if it reads better; mention bundle
  code-splitting for Recharts (monitor bundle ~200 KB gzipped).

## Out of scope (README "next steps")

Authentication, a database (SQLite behind `AlertStore`), horizontal scaling,
high and low thresholds, multiple data sources, Turborepo, canvas charts for high
rates.
