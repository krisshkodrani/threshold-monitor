# ADR 0005: Relay security defaults

Status: accepted (M4)

## Context

Browsers do not apply CORS to WebSockets. Any web page that a user opens can
try to connect to the relay. Clients can also send too many messages, very
large messages, or messages for another role.

## Decision

- Production is the default mode. The relay accepts a WebSocket upgrade only
  when the `Origin` header is the same origin as the page, or is in
  `ALLOWED_ORIGINS`. Development mode also accepts the two Vite dev servers.
- A missing `Origin` is accepted: browsers always send it, and other clients
  can send any value.
- Each message is at most 16 KiB (`maxPayload`). A larger frame closes the
  connection with code 1009.
- The first message must be a valid `hello` within 5 s, else close code 4001.
  The role comes only from `hello`.
- Monitors can only send `alert`. Control rooms can only send `ack`. Other
  messages get the error `NOT_ALLOWED`.
- Each connection has a token bucket: 60 messages, refill 10 each second.
  The specification asked for 20. The value is 60 so that a monitor can send a
  full outbox of 50 alerts after a reconnect. After 100 refused messages in a
  row, the relay closes the connection with code 4008.
- One bad message gets `BAD_MESSAGE`, and the connection stays open.

- The first message must be a valid `hello`. ADR 0006 adds a session check
  before it: a socket without a valid session closes with 4003.

## Consequences

- Before M8 there was no authentication. ADR 0006 adds login with sessions.
- A missing `Origin` is still accepted, but a client without a session
  cookie cannot use the relay.
