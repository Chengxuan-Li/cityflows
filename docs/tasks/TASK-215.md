# TASK-215 — Lane markings

Status: in progress (owner started it 2026-11-18, unsupervised batch). Proposed owner: Claude Code
subagent (Opus 5.5, high). Branch `task/215-markings`, worktree `D:\cityflows-wt\215`, ports 5415 /
5515.

## Goal

Fix the marking cases of TASK-212's audit (`docs/findings/2026-11-19-geometry-audit/README.md`,
"Markings", with close-ups) with general rules, in 2D and 3D (3D uses the same shapes):

- **M1** Arrows at a group entry show the first inner link's turn instead of the turn through the
  group (`r:1277#0` at `n:768`, `r:1396` at `n:867`, `r:1514#0` at `n:1349`; 9 lanes).
- **M2** Lane dashes on short inner links of a junction group splay across the junction (26 of 39
  groups): inner links should carry no lane dashes, or only guide marks where real junctions have
  them.
- **M3** Zebra crossings across the B 31 at ramp diverges and T-nodes (`n:446`, `n:78`, `n:79`,
  `n:242`, `n:913`, `n:1083`; 10 crossing ends): no default crossing over a trunk or motorway-class
  carriageway or a ramp diverge unless OSM maps one.
- **M4** Crossings doubled, or painted over hatches and arrows (`n:1462`, `n:1705`, arrows on a
  zebra at `n:464`; 12 places).
- **M5** Staggered crossing stripes (`r:460` at `n:403` 5.5 m, `n:11`, `n:18`; 6).
- **M6** Stop lines drawn in per-lane pieces (`n:970` on `r:1185`, `n:1132`, `n:1147`; 3).
- **S2 hatch**: if TASK-214 reports that the gain-fan hatch drawing needs a change, it may come to
  you; check with the lead.

M7 (solid lane lines before signals instead of dashes) is a theme rule the owner has not confirmed:
leave it.

## Scope

`src/render/road-paint.ts`, `src/render/marking-geometry.ts`, `src/render3d/markings.ts`,
`src/network/crossings.ts` (default placement only), tests.

Out of scope: `junctions.ts`, `groups.ts`, `lanes.ts`, `lane-drop.ts`, `corridor.ts`, `continuity.ts`
(TASK-213 and 214), `src/schema`, the simulation, fixtures. A crossing change can move walk links and
signal walk phases; if it does, run the traffic checks below, otherwise say that nothing moved.

## Gates

- A test per rule that fails without it; the marking offset measure of the geometry audit not worse.
- Close-ups of every case before and after, 2D and 3D, in `docs/findings/2026-11-19-markings/`.
- If walk links or signal programs move: Munich seeds 1 to 12, choice on, both modes, main against
  branch, and Freiburg's gate; otherwise state hashes unchanged.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`, and the 2D/3D frame budgets
  (render CPU p95) on Freiburg.

## Report

Write it as the commit body: per case, the cause, the rule, before and after.
