# TASK-310 — Load time at airport scale

Status: in progress 2026-11-22 (airports wave E, owner: "load time and 3d rendering are good tasks for performance
optimization"). Proposed owner: Codex CLI (gpt-6.2-sol, high). Branch `task/310-airport-load`, worktree
`D:\cityflows-wt\310`, ports 5510 / 5610.

## Goal

Large airports load far over the bundled-city budget: Heathrow's first frame took 36.7 s and ready 71.7 s from the
New city panel, Boston 5.4 s and 15.3 s, against Freiburg's 2.2 to 2.7 s and 4.7 to 6.3 s (TASK-303 and 304 reviews in
`docs/plan.md`). Profile and cut the load path by general means: archive parse, project open, compile (airside and
road), demand and population generation (TASK-304 skipped the pedestrian compile for population, `src/demand/population.ts`),
flight schedule and airside graph setup, first 2D and 3D scene build. Output must stay identical (archives, compiled
cities, state hashes), as TASK-292 did.

Measurement targets: Heathrow and Boston from the parked branches, held out of the New city panel (opened by
`?city=`): take only their bundling (the archive, the `bench/bundled-cities.ts` entry, and nothing of their sim
changes) from `c0b4b2f` (Heathrow) and `dacf5ae` (Boston), plus the Boston apron rule's archive as built there; if
Zurich (TASK-302) lands on main meanwhile, measure it too. Also London City, Freiburg and York.

## Scope

`src/project`, `src/network` (compile), `src/importers` load path, `src/demand`, `src/sim` setup, `src/render`,
`src/render3d` scene build, `bench/bundled-cities.ts`, `src/ui/bundled-projects.ts` (held-out entries only), tests.

Out of scope: aircraft behaviour and operations (TASK-312), 3D per-frame render cost (TASK-311), schema, gate floors,
`bench/traffic-baseline.json`, any download.

## Gates

- Identical output: every archive, compile and state hash unchanged (existing cities per the rule bullet; London City
  and the held-out airports by their own pins).
- Quiet-machine medians, five interleaved rounds, base against branch: first frame and ready from the panel or
  `?city=` for Heathrow, Boston, London City, Freiburg, York (and Zurich if on main). Aim: Heathrow first frame under
  10 s, Boston under 4 s, the others no slower. Report the profile before and after and what remains.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`, `tests/e2e/real-places.spec.ts`.

## Report

Write it as the commit body.
