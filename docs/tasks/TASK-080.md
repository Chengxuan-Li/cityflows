# TASK-080 — Short transitions, and lanes that continue through the remaining splits and merges

Owner: unassigned
Gate: 5 (owner findings B36, B37, round 3, 2026-11-06)
Depends on: TASK-071, TASK-074, TASK-076. Design: `docs/architecture.md` section 5.1
(TASK-071 lane continuity, TASK-080), section 11 (TASK-071 markings), section 14 (T33). Read
those before the code.

## Goal

From the owner's screenshots in `docs/findings/2026-11-06/`:

- B37 (`3-bend-step-centre-line.png`, clarified by the owner: "the line increase should be
  done in a shorter section instead of a long gradual change"): TASK-071 eases over
  `min(60 m, half the road)`. Make every taper short and speed-scaled per section 5.1.
- B36 (`4-carriageway-split.png`, `5-merge-taper.png`, Munich's multi-lane carriageways): a
  split that is not a continuation node draws as two overlapping surfaces with no lane
  markings between them; a ramp joining draws a jagged outer edge. Lanes should continue side
  by side with dividers until the branches separate, and an absorbing merge should show one
  smooth taper.

## In scope

- `src/network/continuity.ts` and `src/network/lanes.ts`: `taperM`, and the B36 cases per
  section 5.1 TASK-080 (find them first: list every Munich and Sindelfingen node where two
  road surfaces overlap along a split or merge outside a continuation node, with ids).
- `src/render/layers/transitions.ts` and `drawRoadJoins` in `src/render/layers/nodes.ts`
  (TASK-078 edits `drawNode` in the same file in parallel; touch only `drawRoadJoins` and
  helpers of your own).
- Tests: `tests/network/T33-transitions.test.ts`, and T25 expectations that move (taper
  lengths), each named with its reason.

## Out of scope

- `src/network/junctions.ts` (TASK-078), `src/render/layers/roads.ts` (TASK-079), `src/sim`,
  `src/routing`, `src/importers`, `src/ui`. If a case needs new movements, a change to
  `junctions.ts` or to the simulation's merge rules, stop and report it with node ids.

## T33 (unit)

1. Taper lengths: a 50 km/h widening tapers over 20 m, a 100 km/h one over 40 m, a road
   shorter than twice that over half its length; branch offsets, dropped and added lanes alike.
2. On the TASK-071 continuity fixture and Munich: no lane polyline self-intersects, and every
   continuation lane's heading stays continuous across its taper (as T25 checks).
3. B36: on each listed Munich split and merge, the overlap of the two road surfaces outside
   the shared lane block is reported before and after, and dividers are drawn between the
   side-by-side lanes up to the separation point.
4. Simulation: T07's braking bound and T29 hold; Munich at `--scale 0.15` completes at least
   main's count (3 720 on 6053183, zero `stalledHeads`), and the four benchmark hashes are
   reported (they may move with the shorter tapers; completed may not fall).

## Acceptance

- T33 passes; T25's continuation assertions and T27 hold (taper-length expectations move).
- Screenshots before and after of the owner's screens 3, 4 and 5 situations (find them in
  Munich, or the closest equivalents, and name the ids).
- `npm run check` green; `npm run test:e2e -- --grep-invert T16` green on a port of your own;
  `npm run route-audit` zero.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what
is not supported, the B36 case list with ids, T33 results, hashes and Munich numbers,
changed expectations, screenshot paths, the final lines of `npm run check`. Commit in your
git worktree; the lead reviews only commits.
