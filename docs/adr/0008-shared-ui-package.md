# ADR 0008: A shared UI package for the data table

Status: accepted

## Context

Until now, the two apps shared only `@app/protocol`. The rule was "share the
contract, not the logic": each app had its own connection code, badge and
style tokens. The two alert tables then needed the same new behavior: a box
with a fixed height and a sticky header row, a fixed column layout (an
acknowledgement must not move the table), ellipsis with a tooltip, and a
focusable scroll area for keyboard users. Two copies of this would soon
become different.

## Decision

- Add `packages/ui` (`@app/ui`). Like the protocol package, it has only
  TypeScript source. Vite builds it into each app; it has no build step.
- It has one component now: a generic `DataTable<T>`. Each app gives it
  **column definitions** (`id`, `header`, `cell: (row) => ReactNode`, and
  optional `width`, `className`, `title`), the rows, a `rowKey`, and a name
  for the scroll area. The `cell` render function keeps the app's own formats,
  chips and buttons in the app; the table knows nothing about alerts.
- The table owns its CSS (`DataTable.css`). It uses only the token names that
  both apps define, so each app keeps its own look.
- The rule changes to: share the protocol and generic UI parts; keep domain
  logic and connection code in each app.

## Consequences

- One place for table layout, scrolling and accessibility, with its own tests
  (including axe).
- A new table needs only its columns.
- The connection code, the badge and the tokens stay copies. They can move
  to `@app/ui` later with the same pattern, if they need the same changes.
