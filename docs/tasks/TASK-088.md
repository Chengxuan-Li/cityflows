# TASK-088 — Lane dividers across multi-lane splits; markings at n:1181 (B44)

Owner: unassigned
Gate: 5 (geometry rework follow-up)
Depends on: TASK-075 (guide markings), TASK-079, TASK-083 (junction polygons), TASK-085
(through movements at splits). Design: `docs/plan.md` backlog B39, B44 and the TASK-083
review; `docs/architecture.md` sections 5.1 (TASK-083), 5.2 and 11. Read those before the
code.

## Goal

At multi-lane splits and merges that stay ordinary junctions (Munich `n:201`, `n:312`,
`n:305`, `n:194`) TASK-083 draws a smooth surface but no lane dividers across it, so lanes
seem to end and restart. TASK-085 generated the through movements of the lanes that line up;
draw the dividers between neighbouring through movements across the junction, as TASK-075's
guide markings do at unsignalled junctions. Also at R3-1 `n:1181` zebra and stop markings now
show at two approaches where they were hidden before: check whether they are right (a
crossing exists there) or a drawing defect, and fix the latter.

## Design

- At a node whose movements are through, merge or diverge between roads within 30 degrees of
  one axis (TASK-071's classification), draw a dashed divider midway between each pair of
  neighbouring through movements that run side by side (same direction, lateral spacing within
  0.2 m of a lane width) from cut to cut, clipped to the junction polygon; solid where the
  lanes' own dividers are solid. Nothing where movements diverge beyond a lane width (the
  gore).
- Markings only: no geometry, movement or simulation change.

## In scope

- `src/render/layers/roads.ts`, `src/render/layers/junction-markings.ts`, `tests/render`
  (T40), render expectations that move (T32, T20 markings), each named.

## Out of scope

- `src/network`, `src/importers` (TASK-087 in parallel), `src/sim`.

## T40 and the gates

1. `n:201`, `n:312`, `n:305`, `n:194`: every pair of neighbouring through movements has a
   divider across the junction, inside the polygon (0.1 m), continuous with the lanes'
   dividers at both cuts (gap under 0.5 m).
2. No divider crosses a movement of another lane pair, and none is drawn across the crossing
   movements of signalised junctions.
3. `n:1181`: the finding and, if a defect, the fix.
4. Benchmark hashes unchanged; `npm run check` green.

## Acceptance

- T40 passes; `npm run geometry-shots` before and after (B39 shots, R3-1); e2e
  (`--grep-invert T16`) green on a port of your own.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what is
not supported, T40 results, changed expectations, image paths, the final lines of
`npm run check`. Commit in your git worktree; the lead reviews only commits.
