# TASK-219 — Junction-group surfaces and stop lines (J1, TASK-216 D2)

Status: in progress (unsupervised run, owner 2026-11-19). Proposed owner: Claude Code subagent (Opus
5.5, high). Branch `task/219-group-surfaces`, worktree `D:\cityflows-wt\219`, ports 5419 / 5519.

## Goal

TASK-213 left J1 open: inner roads overlap inside one drawn group surface at the Hauptbahnhof
(TASK-212 `docs/findings/2026-11-19-geometry-audit/README.md`, J1: `jg:13298` with `n:1`, `n:970`;
`jg:13268` with `n:5`; worst `r:1185`/`r:973`, `r:1177`/`r:6`; 26 of Freiburg's 56 overlap pairs are
at groups). Since the TASK-214 rebuild these groups are `jg:13297` and `jg:13267`. TASK-216 added
D2: the Hauptbahnhof group swallows a median crossover (way 795829487), so a stop line and zebra are
drawn across five lanes at `n:1147`, 37 m before the painted stop line.

1. A group-level surface and kerb rule so inner roads do not overlap inside the group surface and
   its edge follows the outer kerbs (TASK-213's review says what it tried).
2. Group membership: a group does not extend across a median crossover or a stretch that the ground
   shows as plain road between two junctions (say the rule: inner link length, the crossover's
   tags or shape); stop lines then sit at the real junction.
3. Check every Freiburg and Munich group for the effect; Sindelfingen too.

Groups move stop lines, signals and movement lengths, so traffic moves.

## Scope

`src/network/junctions.ts`, `src/network/groups.ts`, group detection wherever it lives, tests.

Out of scope: crossings and markings (TASK-217; if a stop line drawing needs a change in the
renderer, report it), importer widths, medians and controls (TASK-218), `lanes.ts`, `lane-drop.ts`,
`continuity.ts`, `corridor.ts` (TASK-221 later), `src/schema` (stop and ask), gate floors,
`bench/traffic-baseline.json`.

## Gates

- A test per rule that fails without it.
- Close-ups of every case before and after, 2D and 3D, in `docs/findings/2026-11-19-group-surfaces/`.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes
  (means: completed, gridlocked, mean delay, worst visit; drain criterion of TASK-154); full demand
  both modes (references actuated 3,759 / 143, hash 4028429784; fixed 3,501 / 168, hash 2888500527);
  Freiburg's gate (1,462 / 0, 76 s, hash 1730700508); Sindelfingen; the Munich gate and mode-share
  guard. If nothing moves, show the identical hashes instead.
- The owner's merge rule (plan, owner decisions log, 2026-11-19): mean delay no more than 3% worse in
  any Munich configuration, full-demand delay no more than 2%, Freiburg's gate delay no more than
  5 s, drain criterion on every run. If the first version misses, try one variant (say what it
  drops) and report both tables; the lead decides.
- The geometry audit (`bench/geometry-audit.ts`) on Freiburg, Munich and Sindelfingen: no measure
  worse.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

Where a case is one of TASK-216's aerial defects, show it before and after with
`bench/aerial-overlay.ts` (the imagery is in `D:\cityflows-wt\216-data`, read-only; do not download
anything).

The Freiburg project (`fixtures/projects/freiburg.cityflows.json`) is built from the extract by the
importer and compiler: if your change moves it, rebuild it (`node --experimental-strip-types
--import ./bench/register.ts ./bench/freiburg.ts`) and re-pin in your branch, saying so; the lead
rebuilds again at the merge. No other fixture changes.

## Report

Write it as the commit body: per case, the cause, the rule, the figures; the traffic tables.
