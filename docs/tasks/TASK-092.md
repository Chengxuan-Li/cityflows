# TASK-092 — Every junction corner sweeps with a radius; rounded median noses (B48, B51, B52)

Owner: unassigned
Gate: 5 (owner findings round 5)
Depends on: TASK-083 (junction polygons), TASK-089 (split ends, edge-following curb cubics),
TASK-090 (test tiers). Design: `docs/plan.md` backlog B48, B51, B52 and the screenshots in
`docs/findings/2026-11-06-round5/` (4, 5, 6, 7); `docs/architecture.md` section 5.1 (TASK-083,
TASK-089). Read those before the code.

## Goal

The owner marked sharp corners at these places:

- `n:262` (4, signal; Trappentreustraße `r:252`, the ramp `r:267`, Landsberger `r:364`/`r:922`,
  service `r:264`/`r:265`). The marked corner is not the only one.
- `n:967` (5, signal; Landsberger `r:248`/`r:364`/`r:961`/`r:1276`, ramps `r:703`, `r:968`).
- `n:104` (6), both sides of the south road Astallerstraße `r:106`/`r:107`.
- `n:291` (7, signal): the curb from the north road into the south-west road kinks.

At `n:104` the median nose between the west carriageways (`r:476`, `r:1308`) is square; it
should be rounded.

## Design

1. **Audit first.** Add one measure to `bench/geometry-audit.ts`: corner sharpness. For every
   pair of neighbouring arms at a node, report the curb's smallest radius and its largest
   turn between 0.5 m samples. A corner whose curb is missing, degenerate (shorter than
   0.5 m), or turns more than 30 degrees between samples counts as sharp. Give the baseline
   per city and list the sharp corners. Expect more than the four the owner marked.
2. **Find the cause per kind of corner.** Possible causes: TASK-089's split ends, short cuts
   where the curb has no room, acute arms, arms whose cuts overlap, service roads or ramps
   with a tiny class radius, or the clipper union cutting off an arc. Fix each in the step
   responsible. Every corner between two arms gets a curb with at least its class radius
   (TASK-083's table), shrunk only where the arms' geometry leaves less room, and never
   below 2 m without a named reason.
3. **Median noses.** Where a split pair's median ends at a junction (TASK-089), the nose is a
   semicircle (or a radius of at least half the median width) joining the two carriageways'
   inner edges. It sits at the junction edge, as TASK-089 placed it.
4. **Nothing else moves.** Cuts, setbacks, lanes and movements stay as they are unless a fix
   needs them. Storage stays within TASK-090's budget.

## In scope

`src/network/junctions.ts`, `src/render/layers/nodes.ts`, `bench/geometry-audit.ts` (the
additive measure), `bench/geometry-shots.ts` (cameras), `tests/network` (T38 extended, or a
new T42), and the expectations that move, each named.

## Out of scope

`src/importers`, `src/network/continuity.ts`, `corridor.ts` and `lanes.ts` (TASK-093 is in
parallel), `src/render/layers/roads.ts` (TASK-091), `src/sim`.

## Gates

1. **Sharp corners.** On Munich, Sindelfingen, town and grid: zero, except named ones with a
   reason each. `n:262`, `n:967`, `n:104` and `n:291` have none (shots).
2. **Median noses.** Every split-pair nose is rounded (`n:104`, `n:774`, `n:949`, `n:1181`).
3. **No regressions.**
   - Audit: bulge, self-crossings, measure 9, G2 and through far/near are no worse than main,
     to the tolerances TASK-090 sets.
   - Traffic gate: `npm run test:traffic`. Use `traffic:quick` while iterating.
   - Benchmark hashes unchanged.
4. `npm run check` and `npm run test:city` green; `test:e2e:smoke` green on port 5289.

## Acceptance

All gates. Give `npm run geometry-shots -- <dir> --only ...` before and after, with new
cameras for `n:262`, `n:967` and `n:291` plus B41-n104. Read the images yourself: the
numbers pass easily while corners zigzag.

## Deliverable

A report in the body of your last commit message (no new Markdown files):

- the audit before and after;
- each cause found and its fix;
- named exceptions;
- traffic numbers;
- image paths;
- the final lines of `npm run check`.

Commit in your git worktree; the lead reviews only commits.
