# TASK-357 — Heathrow in the panel: load time, 2D budget, showcase morning

Status: started 2026-11-26 (owner: "add heathrow and improve it in parallel"). Owner: Claude subagent (Opus 5.5).
Base: main.

## Finding (TASK-354, 2026-11-25)

Heathrow joined the New city panel ahead of its gates. Measured on the dev machine:

| Measure | Value | Budget |
|---|---|---|
| Open | allowed 180 s | – |
| First 3D frame | 8.5–8.8 s | – |
| 3D build | 7.7–8.1 s | – |
| 2D render p95 | 4.9 then 2.1 ms (a 6 ms budget recorded for Heathrow) | Freiburg's 4 ms |
| 3D render p95 | 4.6–4.9 ms | 6 ms |

Heathrow's landside showcase morning (the 0.15 morning in `tests/city/bundled-cities.city.test.ts`) has not been
measured.

## Goal

1. Bring the first 3D frame and the 3D build down: profile `setCity` and the airport layers. General speed-ups
   only, no level-of-detail tricks that change what is shown.
2. Bring 2D render p95 under 4 ms reliably, then drop Heathrow's 6 ms exception.
3. Measure Heathrow's landside showcase morning. If it passes, add Heathrow to the showcase-gate list. If not,
   report why: gridlock roads, stalled heads, unroutable trips.

## Scope

`src/render/**`, `src/render3d/**` (airport layers and builds), the real-places spec and the showcase-gate list.

## Out of scope

The sim, the importer and the archive content, unless a pure performance fix needs them; then ask first.

## Gates

- e2e real-places Heathrow test within the budgets.
- Other places' frame times not worse.
- Hashes identical.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`, `tests/e2e/real-places.spec.ts`.
