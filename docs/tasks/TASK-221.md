# TASK-221 — Lane tapers across the plain nodes between short roads

Status: planned (unsupervised run, owner 2026-11-19; starts when a wave A slot frees). Proposed owner:
Claude Code subagent (Opus 5.5, high). Branch `task/221-carry-tapers`, worktree `D:\cityflows-wt\221`, ports
5421 / 5521.

## Goal

TASK-214 fixed most lane split and merge folds but left the cases whose taper must carry on across
the plain (two-road) nodes between short roads: S6 point merges (`n:536` 0.438 m, `n:1130` 0.25 m,
`n:900` 0.39 m joins), S5's tally (84 of 159 untapered lane-count changes in Freiburg do not move),
J2's two remaining lobes at `n:652`, J6 at Munich `n:194` (overlap 59.8 m²), and the Munich join max
0.315 m at `n:19`/`n:624` (TASK-214 review and its commit body `cc70c3e`, in `docs/plan.md`).

A rule that lets a lane gain or drop, or a side shift, spread over a chain of short roads joined at
plain nodes, so the taper has its full length; without moving TASK-213's corners or parting two-way
centre lines (TASK-214's reverted attempt). Per case the cause, the rule and the figures.

## Scope

`src/network/lanes.ts`, `lane-drop.ts`, `continuity.ts`, `corridor.ts`, `compile.ts` where the joint
is closed, tests.

Out of scope: `junctions.ts`, `groups.ts`, the importer, markings and crossings, `src/schema`, gate
floors, `bench/traffic-baseline.json`.

## Gates

- A test per rule that fails without it; the geometry audit on Freiburg, Munich and Sindelfingen with
  no measure worse and the named cases better; close-ups before and after, 2D and 3D, in
  `docs/findings/2026-11-19-carry-tapers/`.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes
  (means: completed, gridlocked, mean delay, worst visit; drain criterion of TASK-154); full demand
  both modes (references on main when you start: see the latest "full-demand references" in
  `docs/plan.md`); Freiburg's gate; Sindelfingen; the Munich gate and mode-share guard. If nothing
  moves, show the identical hashes instead.
- The owner's merge rule (plan, owner decisions log, 2026-11-19): mean delay no more than 3% worse in
  any Munich configuration, full-demand delay no more than 2%, Freiburg's gate delay no more than
  5 s, drain criterion on every run. If the first version misses, try one variant (say what it
  drops) and report both tables; the lead decides.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

If your change moves the Freiburg project (`fixtures/projects/freiburg.cityflows.json`), rebuild it
(`node --experimental-strip-types --import ./bench/register.ts ./bench/freiburg.ts`) and re-pin in
your branch, saying so; the lead rebuilds again at the merge. No other fixture changes.

## Report

Write it as the commit body: per case, the cause, the rule, the figures; the traffic tables.
