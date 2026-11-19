# TASK-232 — Tram track form follow-ups: Rotteckring's ballast and the paving wedge (TASK-224 D8, N3)

Status: in progress (unsupervised run, owner 2026-11-19; from TASK-220's and TASK-224's open items).
Proposed owner: Claude Code subagent (Opus 5.5, high). Branch `task/232-tram-form-followups`, worktree
`D:\cityflows-wt\232`, ports 5432 / 5532.

## Goal

TASK-220 (review in `docs/plan.md`) left two things that TASK-224's aerial re-check
(`docs/findings/2026-11-19-aerial-recheck/`) confirms:

1. **D8 remainder.** About 115 m of Rotteckring track by the Fahnenbergplatz stop (`rt:12913`,
   `rt:12942`, `rt:12944`, `rt:12915`) stays ballast where the ground is paved, because parking bays
   keep it more than 2.5 m from the drawn carriageway (TASK-220's rule 7). Measure the rule to the
   outer edge of the street parking strips (or the road's whole street band), not the carriageway
   alone, so a track inside a street's cross-section counts as embedded; keep untagged track between
   separate roads (a median reservation) as ballast or grass as today. Say the rule.
2. **N3.** A darker asphalt wedge where the embedded track's street paving (TASK-220) meets the
   Rotteckring approach, and a light 1 m strip beside the track that shows more since. Carry the
   paving to the carriageway edge with the road's own colour and texture so no seam or wedge shows.

## Scope

`src/importers/osm/rail.ts` (`assignTramForms`), `src/render/rail-geometry.ts`, `src/render3d/rail.ts`,
tests, the Freiburg rebuild and its pins (tram `form` only), close-ups under
`docs/findings/2026-11-19-tram-form-followups/` (aerial overlay; imagery read-only in
`D:\cityflows-wt\216-data`; download nothing).

Out of scope: `src/network/**`, `src/sim/**`, `src/schema`, the road importer (`roads.ts`,
`corridors.ts`: TASK-231), gate floors.

## Gates

- A test per rule that fails without it; track form counts per city before and after.
- Close-ups of both cases over the imagery and in 3D, before and after.
- Render and form only, so the state hashes must be identical (Munich 0.15 seed 1 four configurations,
  Freiburg's gate, Sindelfingen, both full demands); show them.
- Frame budgets on the Freiburg landing spec (render CPU p95, 2D 4 ms, 3D 6 ms), main against branch.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per case the cause, the rule, the counts; the hashes; the budgets.
