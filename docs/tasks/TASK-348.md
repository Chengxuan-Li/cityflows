# TASK-348 — Lane geometry under junction groups and signalised crossings

Status: proposed 2026-11-25; waits for TASK-347 and four owner decisions (below). Owner: to be decided.
Base: main after TASK-347.

## Finding (lead audit, 2026-11-25)

**Inner roads keep stub lane blocks (J1).** The 5 m trim floor (`compile.ts:319-325`) binds on 69 of 105 inner roads
in Munich, 30 of 32 in Sindelfingen and 121 of 151 in Freiburg.
- Examples: `r:1179` (13 m long, 9.8 + 9.8 m cuts), `r:1309`, `r:1312`, `r:202`.
- The audit has J1-hbf lane overlap at 31.12 m² (9 sharp corners) and J1-stefan at 25.96 m².
- TASK-219 tried lowering the floor to 0.5 m: Freiburg lane overlap went from 214.8 to 139.5 m², but sharp corners
  went from 58 to 100. Without one group surface, the members' kerbs face each other; TASK-347 builds that surface.

**Signalised crossings between junctions** (29 in Freiburg) are laid out as junctions with a 2.5–6.3 m cut. They add
lane overlap: `r:1706`/`r:1821` at `n:1705`, 11.94 m².

## Goal

1. Inner roads shorter than their members' cuts carry no lane block of their own. The floor is lifted for inner
   roads, and movements are chained across the group.
2. Signalised crossings between junctions are laid out as plain nodes, by TASK-255's rule: setback 0, the stop line
   before the stripes, walk link and paint kept.
3. Optional, by decision 1: one-way to two-way nodes become continuations.

## Owner decisions needed

1. Amend `docs/architecture.md` section 5.1 so one-way to two-way nodes become continuations?
2. Should corners bending more than 30° stay drawing-only (TASK-347), or be laid out again as continuations? Laying
   them out again changes turn classification, and so traffic.
3. Keep the 30 m smoothing exclusion around plain degree-two nodes (an owner decision at TASK-131 checkpoint 0)?
4. Retire the superseded branches `task/131-phase3-b56`, `226-group-surfaces-2`, `239-node-crossings` and the
   `D:\cityflows-wt\131p3` worktree?

## Scope

- `src/network/compile.ts`, `lanes.ts`, `junctions.ts`, `continuity.ts`, `stops.ts`
- `src/importers/osm/controls.ts` and `index.ts`: a provenance marker only, no schema change; plus the Freiburg rebuild
- `docs/architecture.md` section 5.1 text, if decision 1 is yes

## Out of scope

`src/sim/**`, routing, signal programs, group membership in `split.ts`, smoothing (unless decision 3 changes it),
acute approaches (J3), J6.

## Gates

- One test per rule that fails without it.
- T23 (nodes fixed), T25, T26, T41, T38, T42, T39.5, T68.
- Census:
  - inner roads shorter than their cuts: 69 / 30 / 121 down to 0;
  - signal nodes drawn as junctions: 2 / 2 / 29 down to 0.
- J1 lane overlap to about 0. Sharp corners not worse.
- Traffic under the owner's merge rule:
  - Munich delay within 3%;
  - full demand within 2% on the mean of seeds 1–5;
  - Freiburg within 5 s;
  - drain criterion met;
  - Sindelfingen, T53 and step time.
- Close-ups as in TASK-347; light test tiers.
