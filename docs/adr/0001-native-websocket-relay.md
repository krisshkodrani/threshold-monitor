# ADR 0001: Native WebSocket relay

Status: accepted (M4)

## Context

The monitor sends alerts, and the control rooms must receive them and send
acknowledgements back. Both directions must be fast. Browsers support
WebSocket natively. Socket.IO adds rooms, fallbacks and its own wire format,
but this project needs only one channel with a few message types.

## Decision

- The relay uses the `ws` package on a plain Node HTTP server, at the path `/ws`.
- The same process serves both built apps and `/healthz`, so production has
  one port and one origin, and needs no CORS.
- Each message is one JSON text frame. `packages/protocol` defines each frame
  (ADR 0002).
- The relay sends a ping every 15 s. A client that does not answer before the
  next ping is terminated.

## Consequences

- The clients write their own reconnect logic (ADR 0004). It is small and
  fully tested with fake sockets.
- There is no fallback to long polling. All current browsers support WebSocket.
- One relay process holds all connections. Refer to
  [docs/architecture.md](../architecture.md) for the scaling limits.
