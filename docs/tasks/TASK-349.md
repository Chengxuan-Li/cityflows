# TASK-349 — Zurich passes the showcase gate and joins the New city panel

Status: started 2026-11-25 (owner: "Fix Flughafenstrasse first"). Owner: Claude subagent (Opus 5.5).
Branch `task/349-zurich-panel`, worktree `D:\cityflows-wt\349`. Base: main.

## Finding (lead, 2026-11-25, main `7c452dc1`)

Zurich Airport (`zurich-airport`) is held out of the New city panel by `heldOutOfPanel` in `bench/bundled-cities.ts`.
The reason, recorded at TASK-302: "showcase gate: gridlock on Flughafenstrasse; load over budget".

The owner's rule (2026-11-20): a place that fails the showcase gate leaves the panel; it is not curated. Re-run today
on main, the showcase gate (`tests/city/bundled-cities.city.test.ts`, "at the showcase demand": the 07:00–10:00
morning at 0.15 persons per resident, mode choice on) fails exactly as at TASK-302:
- `gridlocked: 2`;
- `stalledHeads: 1`;
- worst visit `addedS: 10260.6` on road `r:3407` (Flughafenstrasse, landside, no airside crossing);
- the morning takes 174 s.

At TASK-302, Zurich was ready 31–42 s after the click.

The airside side is fine. On main, full days at 730 movements, seeds 1–3: 577–599 of 750 completed, no gridlock,
0–1 overlap samples.

## Goal

1. Find why trips gridlock and a head stalls on Flughafenstrasse. Fix it with a general app rule:
   - importer, network, demand or sim, whichever holds the cause;
   - no OSM edits and no per-id curation (owner's OSM reading rule).
2. Zurich passes the showcase gate: no gridlock, no stalled head, no unroutable trip, no visit adds 900 s.
3. Check the landing time: report first frame and ready against Freiburg's and the panel places'. If load is over
   budget, find the cause and fix it if it is general; report what remains.
4. Once 2 holds (and 3, or the owner accepts the load time), let Zurich into the panel:
   - remove it from `heldOutOfPanel`;
   - add it to `realPlaces` in `src/ui/bundled-projects.ts`, with a short note;
   - add it to the showcase gate's list and to `tests/e2e/real-places.spec.ts`'s panel list;
   - rebuild the archive with `bench/bundled-cities.ts` if the fix changes it, and re-pin its archive hash with a
     reason.

## Scope

Whatever holds the cause (likely `src/importers/osm/**`, `src/network/**`, `src/demand/**` or `src/sim/**` for
roads), plus:
- `bench/bundled-cities.ts`, `src/ui/bundled-projects.ts`;
- `tests/city/bundled-cities.city.test.ts`, `tests/e2e/real-places.spec.ts`;
- the Zurich archive.

## Out of scope

The airside simulation (`src/sim/aircraft.ts` behaviour), `src/schema` without asking, OSM edits, per-id curation,
other airports' archives unless the rule rebuilds them (then explain).

## Gates

- Zurich's showcase gate passes.
- Existing cities, under the owner's merge rule:
  - byte-identical where the rule does not touch them; otherwise
  - Munich delay within 3%;
  - full demand within 2% on the mean of seeds 1–5;
  - Freiburg within 5 s (gate hash reported);
  - drain criterion met;
  - every panel place's showcase gate still passes.
- London City and Zurich airside unchanged, or explained.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`, `tests/e2e/real-places.spec.ts`.

## Report

Commit body: root cause, the rule, gate numbers, load times, hashes.
