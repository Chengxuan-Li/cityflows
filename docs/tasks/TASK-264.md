# TASK-264 — Lane gains that start where the ground widens (D7, Friedrichstraße), read by rule

Status: in progress 2026-11-21 (third run). Proposed owner: Claude Code subagent (Opus 5.5, high). Branch
`task/264-lane-gain-start`, worktree `D:\cityflows-wt\264`, ports 5464 / 5564.

## Goal

TASK-216's aerial check found D7 (`docs/findings/2026-11-19-aerial-check/README.md`): Friedrichstraße's
westbound lane gain at `n:1146` (`r:1175`, 2 lanes, way 233466339, into `r:1148`, 5 lanes, way 227874537)
draws its turn arrows 19 m nearer the junction than the painted ones. The ground widens upstream of the
painted arrows, while the drawn fan comes after them, because the five-lane way starts about 20 m after
the ground widens. The owner decided on 2026-11-20 that this is to be met by improving the app's reading
of OSM, not by an OSM edit or a per-id curation entry.

Find what in the data tells a lane gain to start earlier than the way split. Candidates: the
`turn:lanes` pocket and its typical length before a signalised stop line, the junction's distance from the
split, the lane counts on either side, `placement` or `width:lanes` on the wider way, and the drawn arrow
room (TASK-240's `arrowRoom`). Write a general rule: where the mapped gain node sits too close to the stop
line for the pocket the turn lanes need, the gain's taper starts upstream on the narrower road. Count the
gains it moves in each city and check a sample against the imagery. If no rule can tell, report that with
the evidence.

TASK-254 (parked) found that `r:1148`'s `width:lanes` turned `n:1146` into a junction fan. Do not build on
it; main reads no tagged widths.

## Scope

`src/network/lanes.ts`, `lane-drop.ts`, `continuity.ts` (the taper and gain positions), the importer only
if the rule needs a tag the city does not carry yet, `src/render/marking-geometry.ts` for arrows that
follow the gain, tests, the Freiburg rebuild and pins, Munich re-pins, close-ups under
`docs/findings/2026-11-21-lane-gain-start/` (aerial overlay; imagery read-only in `D:\cityflows-wt\216-data`;
download nothing).

Out of scope: `src/schema`, signal control, the audit, gate floors, `bench/traffic-baseline.json`, OSM edits,
per-id curation.

## Gates

- A test that fails without the rule; the gains moved per city; `n:1146` and a sample against the imagery,
  before and after.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes; full
  demand on seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3; Sindelfingen; the Munich gate and
  mode-share guard. Where Munich's compiled network is byte-identical, its runs are identical by
  construction; say so instead of re-running them.
- The geometry audit on the three cities, within the lead's tolerance.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the evidence, the rule, the counts, the imagery checks, the audit, the
traffic tables.
