# TASK-218 — Importer road shapes: widths, medians, shared lanes, stop lines (TASK-216 D3 to D6, D9)

Status: in progress (unsupervised run, owner 2026-11-19). Proposed owner: Claude Code subagent (Opus
5.5, high). Branch `task/218-importer-roads`, worktree `D:\cityflows-wt\218`, ports 5418 / 5518.

## Goal

TASK-216 checked the Freiburg Hauptbahnhof box against 20 cm aerial imagery
(`docs/findings/2026-11-19-aerial-check/README.md`) and found these importer inference defects:

- **D3** Five-lane approaches too wide: `r:1179` drawn 17.5 m, ground 15.5 m; `r:261` 17.8 against
  16.0 m (3.5 m lanes; both drawn over an island or gore).
- **D4** Stefan-Meier-Straße's stop line on `r:1178` 9 m past the painted line, beyond a signalised
  cycle crossing whose control `controls.ts` moves to the junction; `r:1185` turned about 35°.
- **D5** Bismarckallee in front of the station (`r:1251`) drawn as two carriageways with a 1.3 m
  median; the ground is one 13.8 m carriageway; west kerb 2.3 m out.
- **D6** A two-way promenade, way 4881345, `lanes=1`, drawn as a 6 m two-lane road with a centre
  line.
- **D9** `width=` ignored: the Rotteckring (`r:1590`) tagged 4 m, drawn 3 m.

Fix them with general rules: read `width` and `width:lanes` (with sane bounds), an urban lane width
nearer the German norm (about 3.0 to 3.25 m by road class, inside built-up areas) where nothing is
tagged, no invented median between a one-way pair that OSM draws as one carriageway's two halves
(say how you tell), a two-way `lanes=1` road as one shared lane without a centre line, and the stop
line kept where the signal stands when its control moves to the junction. Say for each the rule, the
before and after figure, and how many roads it touches in each city.

Width changes move lane positions, stop lines and movement lengths, so traffic moves.

## Scope

`src/importers/osm/roads.ts`, `corridors.ts`, `controls.ts`, `split.ts`, `smooth.ts`, the lane width
inference wherever it lives (`src/network/lanes.ts` only for the width default, if it is there),
tests.

Out of scope: `junctions.ts`, `groups.ts` (TASK-219), crossings and markings (TASK-217), rail
(TASK-220), `continuity.ts`, `lane-drop.ts`, `src/schema` (stop and ask), gate floors,
`bench/traffic-baseline.json`.

## Gates

- A test per rule that fails without it.
- Close-ups of every case before and after, 2D and 3D, in `docs/findings/2026-11-19-importer-roads/`.
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
