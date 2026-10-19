# ADR 0002: One shared protocol package with runtime validation

Status: accepted (M1)

## Current applicability

[ADR 0009](0009-sensor-agent.md) adds a fourth participant, the sensor,
and epoch-millisecond reading timestamps alongside ISO UTC event timestamps.
[ADR 0010](0010-shared-client-package.md) supersedes the separate browser
connection code: both apps now use `@app/client`. The sensor keeps its own
transport. Monitor settings no longer use `localStorage`.

The original decision below records the design when this ADR was accepted.

## Context

Three programs exchange messages: the monitor, the relay and the control room.
TypeScript types alone do not check data at run time, and socket input is
untrusted. Stored data in `localStorage` is untrusted too.

## Decision

- `packages/protocol` defines each message with a zod schema and exports the
  types from the schemas. There is one source of truth.
- Parse functions return a result object and never throw. Callers must handle
  both cases.
- All timestamps are ISO 8601 UTC strings. Alert ids and source ids are UUID v4.
- Unknown fields are removed, not refused, so a newer client can talk to an
  older relay.
- `hello.v` accepts any positive integer, so the relay can answer an unknown
  version with `UNSUPPORTED_VERSION` and close code 4002.
- The package ships TypeScript source. Vite and tsup compile it into each app
  and into the server bundle, so it has no build step of its own.

## Consequences

- A change to a message changes all three programs at once, and the type
  checker shows each place to update.
- The apps share the protocol, but not their connection code. Each app keeps
  its own small copy of the backoff function.
