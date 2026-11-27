# TASK-374 — Boston morning probe crash in ground vehicles

Status: started 2026-11-27 (lead). Owner: Codex (gpt-6.2-sol, high). Base: main.

## Finding (TASK-372)

The Boston Logan morning probe (`bench/import-probe.ts` `probeMorning`, city traffic and the compiled airside together,
demand 0.15) crashes on main before 10:00:

```
TypeError: Cannot read properties of undefined (reading 'x')
    at pointAtDistance (src/geo/polyline.ts:44)
    at boxAt (src/sim/ground-vehicles.ts:2599)
    at lookAhead (src/sim/ground-vehicles.ts:1975)
    at move (src/sim/ground-vehicles.ts:1868)
    at Object.step (src/sim/ground-vehicles.ts:2506)
```

The airside bench (`bench/airside-delay.ts`) runs Boston days without it, so the path is one the city probe reaches and
the bench does not. A crash in the browser app would stop the simulation.

## Goal

1. Reproduce it with a script in the scratch folder; find the first main commit that crashes (bisect if cheap).
2. Fix the cause in `ground-vehicles.ts` (an empty or one-point polyline, a stale path index, a removed vehicle still
   read, or similar), not by guarding `pointAtDistance` alone. If a guard is also right, say why.
3. Add a test that fails without the fix.
4. Report the Boston landside+airside probe (completed, mean delay, worst visit, gridlocks) after the fix. Boston stays
   out of the showcase panel; this task does not add it.

## Scope

`src/sim/ground-vehicles.ts`, `src/geo/polyline.ts` if needed, tests.

Out of scope: gate floors, `bench/traffic-baseline.json`, the showcase panel, OSM edits.

## Gates

- Airside not worse: Heathrow peak seed 1, London City day, Zurich `--daily 730` seed 1 and Boston day seed 1 identical
  to main, or any change explained and not worse.
- Cities byte-identical (Munich, Freiburg state hashes).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Result

The combined Boston probe reproduced the crash on the task base (`b75d9ff2`). At 07:46:23,
a catering truck reached its visit's cancellation cutoff (one minute before it had to leave)
while still at its depot (lane index 154, station 120 m). `homeWay` correctly returned a
zero-distance plan. The expired-visit branch in
`src/sim/ground-vehicles.ts:1384` turned that plan into an empty moving path and installed it.
`boxAt` then tried to sample it through `pointAtDistance`, which requires path geometry.
The return branch now records the dropped visit and removes the vehicle through the normal
cleanup when there is no return leg. Nonempty return paths and `pointAtDistance` are unchanged.

The first-parent failure boundary for this probe is `676d3faa` (TASK-361). The exact probe
completed on its first parent `2f80254d` and failed with the same stack on `676d3faa`.
The reduced airside replay also completed on the earlier airside merges `f4ec8bf5`, `cc610d9e`,
`75d6a7f5`, `3b269ad5`, and `3dcac619`.
`tests/city/ground-vehicles.city.test.ts` replays Boston's seed 1 airside from 07:00 to 08:00,
with the same clock as `probeMorning`. It failed with the original stack before the fix and
passed afterward.

Boston from 07:00 to 10:00 with landside and airside enabled (seed 1, demand 0.15, mode choice
on) completed without a crash. It completed 5,342 road trips with 1,755.9 s mean delay, a
3,503.3 s worst road visit on `r:458`, and 53 gridlocks. There were no stalled heads or parking
or route failures. The final state hash was `834911000`. These road figures match TASK-372's
landside-only run. The showcase gate still fails, and Boston remains out of the panel.

All four seed 1 `airside-delay.ts --checks` reports are byte-identical to fresh `b75d9ff2`
reports after dropping the wall-clock timing field. The older Boston reference had 22 overlap
samples, so the comparison used the post-TASK-370 baseline (zero). These runs use the aircraft
bench's default, without `--vehicles`. The regression and combined probe exercise ground vehicles.

| Airside case | Completed / scheduled | Mean / worst delay (s) | Diverted / cancelled | Overlaps / runway conflicts (non-exempt) | Identity |
| --- | ---: | ---: | ---: | ---: | --- |
| Heathrow peak, 06:00–08:00 | 145 / 188 | 1,726.5 / 6,103.5 | 0 / 0 | 0 / 0 | Identical |
| London City day | 150 / 150 | 11.6 / 185.2 | 0 / 0 | 0 / 0 | Identical |
| Zurich day, `--daily 730` | 729 / 750 | 371.9 / 3,194.5 | 11 / 9 | 0 / 0 | Identical |
| Boston day | 992 / 1,000 | 489.4 / 6,181.5 | 3 / 1 | 0 / 0 | Identical |

The bundled-city mornings (`bench/project-step.ts`, 0.15 demand, 07:00–10:00) also matched.

| City | Baseline state hash | Branch state hash | Completed / failed on both |
| --- | ---: | ---: | ---: |
| Munich | `3476462186` | `3476462186` | 2,581 / 0 |
| Freiburg | `55277987` | `55277987` | 1,527 / 0 |

Verification summaries (zero exit code for each command):

- `npm run check` — `Test Files 307 passed | 1 skipped (308)`, `Tests 2205 passed | 2 skipped (2207)`, `✓ built in 2.15s`.
- `npm run test:city` — `Test Files 77 passed (77)`, `Tests 292 passed | 1 skipped (293)`.
- `npm run test:traffic:light` — `Test Files 2 passed (2)`, `Tests 5 passed | 1 expected fail (6)` (the pre-existing T29 expectation).
- `CITYFLOWS_TEST_PORT=5393 npm run test:e2e:light` — `63 passed (6.1m)`.

TASK-374 passes. The separate Boston showcase gate does not.
