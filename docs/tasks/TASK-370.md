# TASK-370 — Boston: overlapping aircraft bodies on full days

Status: started 2026-11-27 (owner defaults; airside: merge on gates). Owner: Codex (gpt-6.2-sol, high). Base: main
`3602dbd7`.

## Finding

Main's Boston full days have overlapping aircraft bodies: seeds 1 / 2 / 3 have 22 / 0 / 11 overlap samples
(`overlapCount` in `D:\cityflows-wt\330-pilot\R\t360\irm-bos-d1..2.json` and `t353\fo-bos-d3.json`). Heathrow, Zurich
and London City days have 0.

## Goal

Find each overlap: time, the aircraft, where (taxiway, stand, runway, holding point), and what each was doing. Fix the
cause with a general rule in `src/sim/aircraft.ts` (or `flight-operations.ts`), with a test that fails without it.
Overlaps are a correctness defect: two bodies never share space.

## Gates (owner ladder)

1. Boston full days seeds 1–3: overlaps 0; completed not worse; go-arounds not worse in sum; `runwayConflictsReal` 0.
2. Heathrow peaks seeds 1–5, Heathrow days 1–3, Zurich days 1–3 (`--daily 730`) and the London City day: identical to
   main, or not worse in completed and go-arounds with 0 overlaps.
3. `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`; re-pin
   `tests/traffic/bundled-airport-load.test.ts` if it changes. City hashes identical.

Main references: Boston `t360\irm-bos-d1..2`, `t353\fo-bos-d3` (unchanged by TASK-363); Heathrow `t363\m-p1..p5`,
`m-d1..3`; Zurich `t360\irm-zrh-d1..3`; London City `t360\irm-lcy-d1`.
