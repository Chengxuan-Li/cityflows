# TASK-214 — Lane splits and merges

Status: in progress (owner started it 2026-11-18, unsupervised batch). Proposed owner: Claude Code
subagent (Opus 5.5, high). Branch `task/214-splits-merges`, worktree `D:\cityflows-wt\214`, ports
5414 / 5514.

## Goal

Fix the split and merge cases of TASK-212's audit (`docs/findings/2026-11-19-geometry-audit/README.md`,
"Lane splits and merges", with close-ups) with general rules:

- **S1** Sawtooth pinches: 4 to 5 m one-lane segments between two-lane ones in the Hauptbahnhof bus
  area (`r:580`, `r:626`, `r:627`, ... at `n:578` to `n:628`; 8 roads) each get a drop and a gain
  taper.
- **S2** A gain of several lanes draws as a fan of overlapping spikes (`n:1146` 2 to 5, `n:1169` 2
  to 5, `n:1188`, `n:368`, `n:738`). The lane geometry is yours; if the hatch drawing itself needs a
  change, list it for TASK-215.
- **S3** Lanes step sideways at joints (`n:717` 2.3 m, `n:1169` 1.4 m, `n:393`, `n:895`; 124 joins
  over 5 cm in Freiburg) and the Munich regression (join max 0.047 to 0.315 m; corridor gap at
  `r:588`/`r:589` 0.69 m).
- **S4** Lane polylines folding back (`r:1185#4` 3.2 m, `r:653#1` to `#3`, `r:1563#0`, `r:718#0` to
  `#2`; 17 lanes) and the Munich regression (`r:589#0`, `r:728#0` back-steps; Sindelfingen cusp
  `r:1538#0`).
- **S5** Chained gains on short roads crossing the dividers (Dreisamstraße `n:1310`, `n:1312`,
  `n:895`: 2 to 3 to 4 to 5 lanes over roads of 18, 29, 12 and 7 m; 84 of 159 lane-count changes have
  no taper): a lane count that changes several times within a short distance should taper once over
  the run, not per road.
- **S6** Merges and diverges at a single point with an edge notch (`n:536`, `n:447`, `n:453`,
  `n:1130`, `n:544`; 13): a merging lane should run alongside and taper.

TASK-213 fixes `bench/geometry-audit.ts` at the same time; until it merges, measure with a local copy
that skips the missing named cases and adds Freiburg (do not commit changes to the bench).

## Scope

`src/network/lanes.ts`, `src/network/lane-drop.ts`, `src/network/corridor.ts`,
`src/network/continuity.ts`, tests.

Out of scope: `junctions.ts`, `groups.ts`, `bench/geometry-audit.ts` (TASK-213), the marking renderers
and `crossings.ts` (TASK-215), `src/schema`, the simulation, gate floors, `bench/traffic-baseline.json`,
the fixtures. If a case needs a change in another task's file, stop that case and report it.

## Gates

- The geometry audit on Freiburg, Munich and Sindelfingen, before and after: no measure worse on any
  city, folds and joins at or below the recorded figures (Munich 0 back-steps, join max 0.047 m) where
  the regression is yours; a test per rule that fails without it.
- Close-ups of every case before and after, 2D and 3D, in `docs/findings/2026-11-19-splits-merges/`.
- Lane geometry moves lane lengths and change points, so traffic moves: Munich seeds 1 to 12, choice
  off and on, both modes, main against branch, full demand both modes (references actuated 3,345 /
  177, hash 2229666949; fixed 3,210 / 166, hash 2820161686); Freiburg's and Sindelfingen's gates; the
  Munich gate and mode-share guard. If traffic trades gains against losses, stop and report both
  tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per case, the cause, the rule, the figures; the traffic tables.
