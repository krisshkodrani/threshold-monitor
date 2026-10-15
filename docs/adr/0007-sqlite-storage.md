# ADR 0007: SQLite for users, sessions and alerts

Status: accepted (M8)

## Context

Login needs users and sessions that stay after a restart. Before M8, the
relay also kept alerts in memory only, so a restart deleted them, and there
was no record of who acknowledged what.

## Decision

- Use **SQLite** through the module `node:sqlite`, which is part of Node 24.
  There is no new dependency and no native build step.
- One file, at `DATABASE_PATH` (default `<repo>/data/threshold-monitor.db`,
  in Docker `/app/data`, a volume). WAL mode and foreign keys are on.
- Migrations are a list of SQL scripts. `PRAGMA user_version` records how many
  have run.
- Tables: `users`, `sessions` (token hash, user, expiry) and `alerts` (the
  record as JSON, plus `ack_operator`, `ack_user_id` and `ack_at`).
- `createSqliteAlertStore` implements the existing `AlertStore` interface, so
  `routing.ts` did not change. "First acknowledgement wins" is one atomic
  `UPDATE ... WHERE ack_at IS NULL`. The memory store stays for the routing
  tests, and one contract test runs on both stores.
- The table keeps all alerts. `RECENT_LIMIT` is removed.

## Consequences

- Alerts, acknowledgements and sessions stay after a restart.
- `node:sqlite` is a release candidate in Node 24, not yet "stable". The API
  that this project uses is small (`prepare`, `run`, `get`, `all`, `exec`).
- The tsup build keeps the `node:` prefix (`removeNodeProtocol: false`),
  because `sqlite` has no name without it.
- One file means one relay process. Several relays need a shared database,
  for example PostgreSQL behind the same `AlertStore` interface.
- The `alerts` table grows without a limit. A retention job is a next step.
