# TASK-358 — Helicopters at helipads clear of passing aircraft

Status: started 2026-11-26 (owner defaults; airside: merge on gates). Owner: Claude subagent (Opus 5.5). Base: main.

## Finding (TASK-352, 2026-11-26)

In TASK-352's Heathrow peak variants, most body overlaps involved a helicopter at helipad `hl:34862`, with a large
aircraft passing or standing next to it:
- seed 3, one variant: 130 overlap samples;
- other runs: 1–5.

The overlap pairs (for example `G-DWBP` / `G-OSDY` at 27137–27140 s) are logged in
`D:\cityflows-wt\330-pilot\R\t352\*.log`. Main's own ladder runs happen to miss it (0 overlaps at Heathrow peak), but
the hazard is in main's rules: nothing orders a fixed-wing aircraft against a helicopter standing on, landing at or
leaving a helipad next to a taxiway or stand.

## Goal

- Helicopters on helipads, and their hover-taxi and landing paths, are ordered against fixed-wing movement, or kept
  clear of it, by a general rule.
- Fixed-wing aircraft treat a helicopter standing on a helipad like a parked body (TASK-339), and helicopters do not
  start while a large aircraft is passing within reach.
- No per-helipad curation.

## Gates

- Reproduce on the TASK-352 variant (`task/352-idep-arrivals` `43cc8498`, a switch set that showed the 130 samples)
  and fix there first.
- Then on main: Heathrow peak seeds 1–5 not worse (128 / 114 / 124 / 125 / 124 with 0 overlaps).
- Zurich and London City light runs not worse; both have helicopters.
- Full days for Heathrow, Zurich and Boston, seeds 1–3, against main.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
