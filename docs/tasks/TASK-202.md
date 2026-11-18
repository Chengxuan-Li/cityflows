# TASK-202 — Trams to every Freiburg stop

Status: in progress (owner started it 2026-11-18). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/202-tram-stops`, worktree `D:\cityflows-wt\202`, ports 5402 / 5502.

## Goal

TASK-198 got trams running in Freiburg (5 routes at 10 per hour, 4 through Bertoldsbrunnen), but 8 of
its 32 tram stops are served by no route (`tramCensus(...).unservedStops` in `src/network/trams.ts`;
`tests/city/freiburg.city.test.ts` pins 24 served). Find why each one is unserved (a stop off the
track a route takes, a branch no route covers, a stop placed on the wrong track or direction, a
route that ends before it) and fix the general cause in the timetable or stop placement, not by
curating Freiburg. A stop with no track a tram could reach stays unserved, and you say why.

Say for each of the 8 stops what was wrong and whether it is now served. Munich's and Sindelfingen's
timetables must not change unless the same cause hides stops there too; if it does, list the change
and re-pin with the reason.

## Scope

`src/network/trams.ts`, `src/network/rail.ts` (timetable and stop placement), the tram parts of the
OSM importer if a stop is imported onto the wrong track, tests.

Out of scope: `src/schema`, signals and car traffic rules, the Freiburg extract and project file
(TASK-201 rebuilds them at the same time; the timetable is built at load, so this task should not
need to), gate floors, `bench/traffic-baseline.json`.

TASK-201 runs at the same time and re-pins Freiburg's city hash; the lead merges in order and the
later task re-pins after rebasing.

## Gates

- A test per cause found (a small rail fixture that failed before the fix).
- Freiburg's gate passes with the new served count pinned; trams still run through Bertoldsbrunnen;
  the Munich gate and the mode-share guard unchanged.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
- A 2D screenshot of Freiburg with the tram routes shown, before and after, in
  `docs/findings/2026-11-18-tram-stops/`.

## Extension (owner, 2026-11-18): the tram-crossing stop line

Serving the Rotteckring stops sends trams over the Eisenbahnstraße crossing (rn:12907/rn:12948) for
the first time, and Freiburg's gate fails with 1 gridlocked trip: a car on r:1719#0 waits at a
crossing stop line on green, with its exit empty and no tram near. The crossing logic
(`src/sim/rail-crossings.ts`, TASK-176's path ahead) takes per facility the nearest stop marking on
the car's path; this facility has a stop on r:1719 for a turn the car does not make, and the car meets
the same facility 185 m further on, so it is held by a red 191 m ahead. Fix it on this branch: a car
obeys a facility's stop marking only for the span it is about to cross there (or an equivalent
general rule). `src/sim/rail-crossings.ts` joins the scope. Added gates: a unit test on a small fixture
(a facility with stops on two approaches, a car passing one without crossing there) that fails without
the fix; Freiburg's gate with 0 gridlocked; Munich seeds 1 to 12, choice off and on, both signal
modes, main against branch (completed / gridlocked / stalled / mean delay / worst loop visit; TASK-154's
drain) and full demand both modes (references: actuated 2,997 / 160, hash 2745499315; fixed 2,859 /
181, hash 628103954), plus Sindelfingen's gate. If Munich trades gains against losses, stop after
measuring and report; the owner decides.

## Report

Write it as the commit body: the 8 stops, cause, fix, served count, and whether any other city moved.
