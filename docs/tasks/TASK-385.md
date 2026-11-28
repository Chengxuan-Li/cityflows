# TASK-385 — TASK-254 to main: the audit reads mapped medians; the B 31 on-ramp bulge

Status: started 2026-11-28. Started by the lead in the 9 h autonomous run (owner 2026-11-28: "Take all suggestions"). Owner: Codex (gpt-6.2-sol, high). Base: main; carries branch
`task/254-placement-widths` (`2e58a343`, on main `d510b589`).

## Finding (TASK-254)

TASK-254 reads `placement` and tagged widths by rule. The traffic merge rule passes (Munich identical, Freiburg gate
62.5 to 60.6 s) and overlaps fall, but the geometry audit misses its tolerance:
- Sindelfingen A 81: voids 1,335 to 2,075 m². `placement=right_of:1` opens the real median between the carriageways;
  the audit takes a median as 0.5 m.
- Freiburg: bulge 9.07 to 15.89 m² at `n:536`, where the B 31 on-ramp joins the placed `r:538`.
- Sharp corners 60 to 62.

## Goal

The owner accepted (2026-11-28) that the audit counts a median the data place (the gap `placement` and tagged widths
open between paired carriageways) as a median, not a void. Then:
1. Change the audit so that gap is not a void; any other void is still counted. One rule, no per-id lists.
2. Trace the `n:536` bulge and fix it by rule (an on-ramp joining a placed carriageway), not by curation.
3. Bring TASK-254 onto current main (merge main into the branch or rebuild it on main), rebuild the bundled cities
   (`bench/bundled-cities.ts`) and re-pin.

## Scope

`bench/geometry-audit.ts`, `src/network/roads.ts`, `src/network/corridors.ts` and what the on-ramp join needs, tests,
bundled-city rebuilds and re-pins. Out of scope: OSM edits, per-id curation, gate floors, `bench/traffic-baseline.json`.

## Gates

- Traffic merge rule against main (Munich within 3%, full demand within 2% on the mean of seeds 1–5, Freiburg within
  5 s, drain, every showcase passes).
- Audit within tolerance against main on the changed audit (<1 cm, <1 m², one non-sharp corner), apart from the
  accepted median gaps; report the median area separately.
- A test for the audit rule and one for the on-ramp join, each failing without its change.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
