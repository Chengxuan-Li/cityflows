# TASK-375 — Audit lane overlap leaves out the group surface

Status: started 2026-11-27 (owner: "Change the audit measure", after TASK-371). Owner: Codex (gpt-6.2-sol, high).
Base: main `211bbd18`.

## Finding (TASK-371)

The inner roads of junction groups keep lane blocks under the 5 m trim floor (69 / 30 / 121 in Munich, Sindelfingen
and Freiburg). The app draws none of them:
- TASK-131/215 draw an inner road under 15 m with no lines;
- TASK-347's group surface covers it.

They exist only in measure 9 of `bench/geometry-audit.ts` (lane overlap, `overlapPieces`). It leaves out overlap
under a node's `outline` of the same grade, but not under the group surface (`groupSurface` in
`src/render/layers/nodes.ts`, already imported by the audit).

TASK-371 grew the member outlines to cover the stubs, a change to compiled data with no visible effect, and missed
two gates. The owner chose to change the measure instead: overlap the app draws as one group surface is not a lane
overlap.

## Goal

Measure 9 leaves out overlap under a group's surface, at the group's grade, as it does under node outlines (the
`outsideOutlines` path). The by-road-end variant (B55, outlines included on purpose) stays as it is.

## Scope

`bench/geometry-audit.ts` and its tests. No change to `src/`; the compiled city and traffic stay identical.

Out of scope: `src/**`, `bench/traffic-baseline.json`, gate floors, other audit measures.

## Gates

- Every other audit measure identical to main on the Munich, Sindelfingen and Freiburg audits (state the totals).
- Measure 9 before and after per city, and for J1-hbf, J1-stefan and J2. List each road pair that drops and confirm
  that it lies under a group surface; no pair outside a group surface changes.
- The drawn-stub census (TASK-371's script in `D:\cityflows-wt\330-pilot\R\t371\`) read against the group surface:
  report it per city.
- A test that fails without the change: an inner-road overlap under a group surface is not counted; the same overlap
  outside any group surface still is.
- `npm run check`, `test:city`, `test:traffic:light`. No e2e needed (no app change); say so if a pin needs it.