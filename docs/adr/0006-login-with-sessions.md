# ADR 0006: Login with server sessions

Status: accepted (M8)

## Context

Before M8, the relay had no authentication. Each person who could open the
page could send alerts and acknowledge alarms. The operator name was free
text, so "Acknowledged by" could not be trusted.

## Decision

- **One login for both apps.** The relay serves one login page at `/login`.
  Each user has roles: `operator` (control room) and `monitor`. A user can
  have both.
- **Server sessions in a cookie.** After a correct login, the relay sets the
  cookie `tm_session`: a random 32-byte token, `HttpOnly`, `SameSite=Strict`,
  `Path=/`. `Secure` is set when `COOKIE_SECURE=true`. The database keeps only
  the SHA-256 of the token. A session lasts `SESSION_TTL_HOURS` (default 12).
- **The WebSocket uses the same cookie.** Browsers send cookies with the
  upgrade request, so the protocol needs no token. A socket without a valid
  session closes with **4003**. A browser cannot read the HTTP status of a
  refused upgrade, but it can read a close code. The apps stop reconnecting
  and go to the login page.
- **The role is checked at `hello`.** `monitor` needs the user role
  `monitor`, and `control` needs `operator`. Otherwise `NOT_ALLOWED` and 4003.
- **The operator name comes from the session.** Protocol version 2 removes
  `operator` from `ack`. The relay writes the user's display name, and the
  store records the user id.
- **Passwords:** scrypt from `node:crypto` (N = 2^15, r = 8, p = 1, 16-byte
  salt). A login with an unknown username also runs scrypt, against a dummy
  hash, so the response time does not show which usernames exist.
- **Login protection:** the same Origin rule as the WebSocket, a token bucket
  for each address (5 tries, then 1 every 10 s), a 4 KiB body limit, and a
  `next` value that must be a local path (no open redirect). The login page
  has no scripts and a strict Content-Security-Policy.
- **Users** are added with a CLI (`user:add`); the password comes from stdin.
  `DEMO_USERS=true` adds two demo users for development and tests.

Alternatives:

- A shared token for each role: simple, but the operator name stays free text.
- An external identity provider (OIDC): the best choice for a company, but a
  reviewer then needs an account or a local Keycloak. The session cookie of
  this design can come from an OIDC login later without a change to the relay.
- A JWT in place of a server session: a server session can be ended at once
  (logout, or a deleted user), and a database is there already.

## Consequences

- The apps are static files and stay public. Their data comes only through
  `/ws`, which needs a session.
- The relay checks the session when a socket connects, and again on each
  heartbeat (every 15 s). An expired or deleted session loses its sockets
  within one heartbeat, with 4003. Logout closes them at once.
- There is no page to manage users or to change a password yet.
- Behind TLS, set `COOKIE_SECURE=true`.
