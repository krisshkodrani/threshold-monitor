# Interactive architecture guide

The guide uses React and TypeScript, with `useReducer` and Immer for simulation
state. It is a separate workspace app and does not connect to the real relay.

```sh
pnpm --filter @app/architecture-guide dev
pnpm --filter @app/architecture-guide test
pnpm --filter @app/architecture-guide typecheck
pnpm --filter @app/architecture-guide build
```

Development runs on port 5175. Building also regenerates
[`docs/architecture-guide.html`](../../docs/architecture-guide.html), a single
file that can be opened directly and works offline. Edit the source here;
do not edit that generated file. Commit the export alongside source changes.

## Source boundaries

- `src/content/`: authored HTML sections, code excerpts and simulation cases.
- `src/styles/`: guide, learning chapters, simulator, message-map and workspace styles, in cascade order.
- `src/simulator/`: typed model, pure transitions, detector, message projections,
  snapshot validation and React alarm lists.
- `src/presentation/`: existing SVG rendering, navigation, dialogs and educational
  interactions, mounted and disposed by React.
- `src/App.tsx`: owns the reducer and connects the presentation adapter and React
  views. Only named reducer actions can change simulation state.

The authored documentation stays static. React owns the alarm list subtrees;
the presentation adapter owns the remaining DOM and SVG descendants. Keep those
ownership boundaries explicit: do not write `innerHTML` into a React-owned list.
DOM listeners and resize observers are disposed when the adapter unmounts.
Rendering does not write local storage; commands and preference changes do.

The existing version-1 local snapshot key is retained. Loading validates the
snapshot and restores the current manual stage. Presentation state (tooltips, dialogs,
selected message) stays out of the domain reducer.

The simulator advances only through Step. Acknowledge sends a request; three
more Step clicks store it, broadcast the result, and apply it to browser copies.
Routes remain highlighted between steps; there is no automatic playback.

Run the browser regression checks from the repository root:

```sh
pnpm test:guide
```

The interview questions are maintained separately in
[`docs/interview-questions.html`](../../docs/interview-questions.html).
Run `pnpm --filter @app/e2e export:questions` to regenerate their PDF.

The entire guide supports English and German through one language switch in the
header. The preference is stored locally. `src/content/translations/de.json` translates authored chapter text; code
excerpts, protocol identifiers, and raw JSON payloads remain in English. Switching
language preserves the existing DOM, selected code, and simulation state.

Code Explorer starts with the sensor reading source and follows detection,
delivery, relay persistence, browser state, and acknowledgement. Source examples
are grouped by Sensor, Relay, Live Monitor, Control Room, and Packages. Redux
state and reducers share one example in the monitor part. Store wiring, trivial
replacement reducers, and the generic table contract are omitted from the tour.
The Vite build highlights TypeScript excerpts with the workspace TypeScript
lexer, with line numbers and syntax colors. There are no emphasized lines or
highlight explanations. Syntax coloring runs
at build time, preserves copied source text, and works in the offline export.

The visible guide has three views: system overview, live simulator, and code explorer.
State & Resilience and React Architecture sources are retained but excluded from
navigation, rendering, and search. Old bookmarks open the code explorer instead.
The explorer combines Redux state and reducers with source excerpts about pure
crossing detection, retry confirmation, connection cleanup, bounded readings,
and local form drafts versus server-confirmed settings. Each decision includes
a short explanation and tradeoff; new excerpts are checked against repository source.

Presenter material: [10-minute run sheet and script](../../docs/presentation-notes.html)
and [printable PDF](../../docs/presentation-notes.pdf). Regenerate the PDF with
`pnpm --filter @app/e2e export:presentation`.

All three browser apps use the shared theme and project navigation in `packages/ui`.
Project links open in a new tab. Development uses ports 5173/5174/5175; the offline
guide links to local apps. Deployment serves the guide at `/architecture/` on the
relay origin, alongside `/` and `/control/`.

The “Adjust hysteresis band” case starts with edges 24.7–25.3°C, then requests
a 0.2°C band after sample 2. Sensor receipt narrows the edges to 24.9–25.1°C
without creating an alert. Later 24.85°C and 25.15°C samples cross the new edges;
the same sequence produces no alerts with the original band. Tests also cover
reloading between relay persistence and sensor receipt.

Branding: **Threshold Monitor** names the system. Its three browser destinations
are **Live Monitor**, **Control Room**, and **Architecture Guide**. Shared
navigation names live in `packages/ui/src/projectLinks.ts`; browser tabs use
“<part> · Threshold Monitor”. The guide’s Overview, Live Simulator, and Code
Explorer are sections of the Architecture Guide, not separate products.

Screen layout uses a 100dvh shell: guide navigation stays outside the scrolling
main area. The simulator fills that area; reference content scrolls within it.
The live apps likewise keep headers visible, scroll long tables internally, and
use a scrolling monitor workspace on narrow screens. Live lists do not paginate.

Code Explorer uses the full available width and height. Its file browser and
code reader scroll independently; wide screens place input/output and decision
notes beside the excerpts. Tablet and mobile layouts use a grouped example
picker. Previous/next follows the sensor-to-browser journey, then supporting
settings, subscription, and shared-package examples. New excerpts are checked
verbatim against repository source during the guide tests.

Localization includes dynamic simulator stages, detector decisions, SVG labels,
message tooltips, dialogs, navigation, validation, search, and React alarm lists.
The presentation adapter translates its own text nodes and accessibility labels;
React portals receive the language explicitly. Changing language preserves the
simulation, current acknowledgement stage, selected example, and original code.
