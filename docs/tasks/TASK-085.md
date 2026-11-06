# TASK-085 — Through movements at multi-lane splits and merges

Owner: unassigned
Gate: 5 (geometry rework, stage 2; backlog B39)
Depends on: TASK-071, TASK-076, TASK-080. Design: `docs/plan.md` "Geometry rework" (stage 2,
the gates) and backlog row B39, `docs/architecture.md` section 5.2 (movement generation) and
section 5.1 (TASK-071, TASK-080). Read those before the code.

## Goal

At Munich's multi-lane splits and merges that stay ordinary junctions (`n:312`, `n:305`,
`n:201`, `n:194`) some lanes have no movement into the lane that lines up with them on the
branch: `r:313` has none into `r:692`, so its lanes cannot continue across the split and
nothing can be marked there. Generate those movements, so lanes continue as they physically
do; stage 3 then draws them.

## Design

At a node whose movements are through, merge or diverge between roads within 30 degrees of one
axis (as TASK-071 classifies them), every lane of the trunk whose position across the node
lines up with a branch lane (the TASK-071 slice: the branch's lane block placed where those
trunk lanes end) gets a through movement into that lane, unless a turn rule bans it. Movements
that exist are kept; nothing is removed. Lane-level routing, `isLaneDrop` (TASK-076) and the
simulation's merge rules use the new movements without change.

## In scope

- `src/network/movements.ts` (and helpers in `src/network/continuity.ts` only if the slice
  computation is shared; TASK-082 changes `lanes.ts` in parallel, so do not touch it).
- Tests: `tests/network/T37-split-movements.test.ts`, routing and movement expectations that
  move (throughput routes, T25, movement counts), each named.

## Out of scope

- Geometry (`lanes.ts`, `junctions.ts`), `src/render`, `src/importers`, `src/sim` rules.

## T37 and the gates

1. `n:312`: `r:313#0>r:692#0` and `r:313#1>r:692#1` exist (or the lanes that line up, named);
   likewise each lane that lines up at `n:305`, `n:201`, `n:194`, listed with ids.
2. Every Munich and Sindelfingen node of that kind: each trunk lane that lines up with a branch
   lane has a through movement into it; counts before and after.
3. No new movement crosses another new movement at the same node.
4. The plan's traffic gate, including `npm run route-audit` zero, and T07, T29 holding.

## Acceptance

- T37 passes; the counts; `npm run check` green; e2e (`--grep-invert T16`) green on a port of
  your own.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what is
not supported, the movements added per node, T37 results, the traffic numbers, changed
expectations, the final lines of `npm run check`. Commit in your git worktree; the lead
reviews only commits.
