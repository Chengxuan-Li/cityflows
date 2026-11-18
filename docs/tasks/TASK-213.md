# TASK-213 — Junction shapes

Status: done 2026-11-19 (J4 and the audit bench; other cases handed on, see the review). Proposed owner: Claude Code
subagent (Opus 5.5, high). Branch `task/213-junction-shapes`, worktree `D:\cityflows-wt\213`, ports
5413 / 5513.

## Goal

Fix the junction cases of TASK-212's audit (`docs/findings/2026-11-19-geometry-audit/README.md`,
"Junctions", with close-ups) with general rules, not per-city curation:

- **J1** Group surfaces at the Hauptbahnhof: inner roads overlap inside the one drawn surface
  (`jg:13298` with `n:1`, `n:970`; `jg:13268` with `n:5`; worst `r:1185`/`r:973`, `r:1177`/`r:6`;
  26 of Freiburg's 56 overlap pairs are at groups).
- **J2** Lobed, wavy group edges (`jg:13295`, `n:652`, inner road `r:653`; bulge at 31 nodes).
- **J3** Acute side roads drawn over the main road (`n:430`/`n:289`, 16.6°; `n:889`; 30 pairs
  outside groups).
- **J4** Curb corners without a radius (`n:44` 180°, `n:128`, `n:390`, `n:2206`, `n:660`; 106 in
  Freiburg, 45 over 90°) and the regression in sharp corners: Munich 9 to 22 (`n:324`, `n:621`,
  `n:549`), Sindelfingen 8 to 31 (`n:87`, `n:27`, `n:1162`, `n:12`).
- **J5** Through roads bending at side streets (`n:552` 5.3 m, `n:1747`, `n:1132`, `n:1462`; 33
  nodes over 10 cm).
- **J6** Ramp diverges overlapping their parent road (Munich `n:27`, `n:194`; Sindelfingen `n:1028`).

First, fix `bench/geometry-audit.ts` so it runs on main: replace the named cases whose nodes no longer
exist (R3-1 `n:1181`, R3-7 `n:949`, after TASK-131 renumbered Munich) with their current ids or drop
them with a note, and add Freiburg as a city. That is the measuring tool for this task and TASK-214.

Say for each case what was wrong, the rule changed, and the before and after figure.

## Scope

`src/network/junctions.ts`, `src/network/groups.ts`, `bench/geometry-audit.ts`, tests.

Out of scope: `src/network/lanes.ts`, `lane-drop.ts`, `corridor.ts`, `continuity.ts` (TASK-214 runs
at the same time and owns them; if a case needs a change there, stop that case and report it), the
marking renderers and `crossings.ts` (TASK-215), `src/schema`, the simulation, gate floors,
`bench/traffic-baseline.json`, the fixtures.

## Gates

- The geometry audit on Freiburg, Munich and Sindelfingen, before and after: no measure worse on any
  city, the named cases' figures better; a test per rule that fails without it.
- Close-ups of every case before and after, 2D and 3D, in `docs/findings/2026-11-19-junctions/`.
- Junction geometry moves stop lines and movement lengths, so traffic moves: Munich seeds 1 to 12,
  choice off and on, both modes, main against branch, and full demand both modes (references actuated
  3,345 / 177, hash 2229666949; fixed 3,210 / 166, hash 2820161686); Freiburg's and Sindelfingen's
  gates; the Munich gate and mode-share guard. If traffic trades gains against losses, stop and report
  both tables (the owner decides).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per case, the cause, the rule, the figures; the traffic tables.
