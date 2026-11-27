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