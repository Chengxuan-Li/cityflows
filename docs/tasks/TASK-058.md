# TASK-058 — Sheets and inspector overlap

Owner: unassigned
Gate: 5 (owner backlog B14)
Depends on: TASK-050, TASK-033

## Goal

A sheet opened from the run bar (Demand, Chart, Layers, Compare) and an open inspector must
never cover each other. The inspector sits top right with `max-height: calc(100% - 100px)`
(`src/ui/app.css`), the sheets rise from the run bar (`.chart-sheet`, `.layers-sheet`), and
the Demand sheet is tall enough at 1440 × 900 with wider fonts (Linux, the CI runner) to
cover the lower part of a place inspector with Hourly profile expanded, so its buttons cannot
be clicked until the sheet closes. TASK-052 worked around it in the e2e scenario; the layout
should make the workaround unnecessary.

## In scope

- `src/ui/app.css`, `src/ui/run-bar.tsx`, `src/ui/App.tsx`, and the inspector container
  component under `src/ui/inspector` only as far as it needs a size hook: when a sheet is
  open, the inspector's maximum height is the space above the sheet (a CSS variable set
  from the sheet's measured height, or a layout rule that reserves the sheet's height), so
  the inspector scrolls instead of being covered; at narrow widths where both cannot fit,
  the sheet wins and the inspector collapses to its heading. No new panel chrome.
- `tests/e2e/gate3-places.spec.ts`: remove the TASK-052 workaround (the sheet closing before
  "Use default timing") and keep the scenario green; a new assertion that with the Demand
  sheet open every inspector button receives a trial click (`click({ trial: true })`) at
  1280 × 720 and 1440 × 900.

## Out of scope

- Panel contents, the wizard (TASK-053 edits it in parallel), the map, the hint cards.

## Acceptance

- With each of the four sheets open and a place inspector with Hourly profile, Events and
  Connectors expanded, no inspector control is covered at 1280 × 720, 1440 × 900 and
  1920 × 1080; verified also with the root font switched to Verdana for the run (the plan's
  "Lead handover" section explains why), which must be reverted before the PR.
- Screenshots of the Demand sheet with the inspector at 1440 × 900 before and after.
- `npm run check` green; `npm run test:e2e` green.

## Commands

`npm run check`, `npm run test:e2e`

## Deliverable

PR with the layout change, the e2e change and the screenshots.
