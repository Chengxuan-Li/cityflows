# TASK-217 — Markings and crossings (TASK-215 reworked, with D1 and M7)

Status: done 2026-11-19 (merged as the paint-only variant `51fd128`; the full version missed the merge rule). Proposed owner: Claude Code subagent (Opus
5.5, high). Branch `task/217-markings-crossings`, worktree `D:\cityflows-wt\217`, ports 5417 / 5517.

## Goal

TASK-215 fixed the marking cases M1 to M6 of TASK-212's audit on branch `task/215-markings`
(`3e5e33f`, worktree `D:\cityflows-wt\215`), but was held: Munich delay rose 4.0% actuated and 5.3%
fixed with choice on, mostly from its doubled-crossing rule (M4), and the Freiburg project needed a
rebuild. Since then TASK-214 changed the lane geometry its markings sit on, and TASK-216 found that
the default crossings are mostly in the wrong places (D1: 155 of 167 drawn crossings in the
Hauptbahnhof box are over 4 m from any OSM-mapped crossing; none of the five mapped zebras is
matched; `n:211` 5.4 m off, `n:1139` on the wrong arms).

1. Bring TASK-215's rules onto main (cherry-pick or redo; its report is the commit body of
   `3e5e33f` and the review in `docs/plan.md`). Read TASK-214's note on `transitionMarkings` in the
   plan's TASK-214 review.
2. **D1:** draw crossings where OSM maps them (`highway=crossing` nodes and `footway=crossing` ways,
   with `crossing=zebra|marked|traffic_signals|unmarked` choosing zebra stripes, the dashed lines of
   a signalised crossing, or nothing), and default ones only where nothing is mapped near a
   junction arm. Check whether the doubled-crossing rule (M4) is still needed once mapped crossings
   lead; drop it if not.
3. **M7** (owner-approved default, German practice): lane lines become solid over the last stretch
   before a stop line (about 30 m, shorter on short roads; not across a lane gain); dashes elsewhere.
4. If TASK-214's gain-fan hatch needs a change in `marking-geometry.ts`, make it.

Crossings move walk links and signal walk phases, so traffic moves: measure it as below.

## Scope

`src/render/road-paint.ts`, `src/render/marking-geometry.ts`, `src/render3d/markings.ts`,
`src/network/crossings.ts`, `src/network/walk.ts` and `src/importers/osm/walk.ts` where crossings
feed walk links, the importer's crossing tags, tests, the inspector only if TASK-215 needed it.

Out of scope: `junctions.ts`, `groups.ts` (TASK-219), `src/importers/osm/roads.ts`, `corridors.ts`,
`controls.ts`, `lanes.ts` (TASK-218), rail and tram drawing (TASK-220), `src/schema` (stop and ask
if a field is needed), gate floors, `bench/traffic-baseline.json`.

## Gates

- A test per rule that fails without it.
- Close-ups of every case before and after, 2D and 3D, in `docs/findings/2026-11-19-markings-crossings/`.
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
