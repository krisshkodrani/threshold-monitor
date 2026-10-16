# ADR 0010: A shared client package for the two apps

Status: accepted. It changes one rule of ADR 0008.

## Context

ADR 0008 kept the connection code in each app: "share the protocol and
generic UI parts; keep domain logic and connection code in each app". After
M9, both apps were views of the relay, and the copies were almost the same:
`relayConnection.ts` (different only in the role and the name), `useRelay.ts`,
`auth.ts`, `ConnectionBadge.tsx` and `AccountBar.tsx` were byte-identical.
That was about 350 lines and two copies of the badge CSS. Each fix to the
reconnect, the backoff or the session check had to be made two times.

## Decision

- Add `packages/client` (`@app/client`). Like the other packages, it has
  only TypeScript source and no build step.
- It holds the client side of the relay for a browser app:
  `createRelayConnection` (the role and the name are options), `useRelay`,
  the session check (`fetchAccount`, `loginUrl`, `logout`), and the two
  status parts, `ConnectionBadge` and `AccountBar`, with their own CSS.
- The apps keep their domain, their state and their screens. Neither app
  imports the other.
- ESLint: app components and app domain code may not import
  `@app/client` (type imports are allowed). Only `App.tsx` and `main.tsx`
  connect to the relay.
- The sensor keeps its own transport. It runs in Node, has an outbox, and
  speaks as a service with a token, not as a user.

## State in the two apps

The apps use two state tools on purpose:

- **The monitor uses Redux Toolkit.** It has three slices (alerts,
  settings, sensor), memoized selectors for the counts and the chart
  markers, and live readings outside Redux.
- **The control room uses one `useReducer`.** It has one list, and all
  its rules are in one pure reducer.

Use a reducer while a screen has one list of state; use Redux when it has
several slices that many components read.

## Consequences

- One place for the reconnect, the backoff, the session check and the badge,
  with one set of tests that covers both roles.
- A new browser app gets a connection with three lines in its `main.tsx`.
- The sensor still has a copy of the backoff formula (ADR 0004).
