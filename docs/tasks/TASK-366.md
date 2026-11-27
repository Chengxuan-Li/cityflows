# TASK-366 — Go-arounds from ground refusals at landing commitment, with TASK-363 on

Status: started 2026-11-26 (owner defaults; airside: merge on gates, realism changes allowed with a cited rule).
Owner: Claude subagent (Opus 5.5). Base: `task/363-arrival-sequence` `ba580b5f` (main `d67ad853` + TASK-363, rule
switched off by default).

## Finding (TASK-363, 2026-11-26)

TASK-363's arrival step-out rules (`T363=pk`) were measured on main after TASK-365 (`D:\cityflows-wt\330-pilot\R\t363\m-*.json`
against `t360\irm-*`):

| Heathrow | Main | `T363=pk` |
|---|---|---|
| Peaks, seeds 1–5 | 676 | 689 |
| Full days, seeds 1–3 | 849 / 813 / 757 | 871 / 869 / 827 |
| Diversions | 112 / 145 / 162 | 104 / 112 / 126 |
| Mean delay (days) | 14,350 / 14,185 / 16,064 s | 14,163 / 12,050 / 12,818 s |
| Go-arounds (days) | 21 / 15 / 15 | 21 / 22 / 28 |

Real runway conflicts are 0, with no gridlock. Go-arounds rise 51 → 71 over the three days, against the "not worse"
gate, so TASK-363 stays off.

TASK-363 found that the extra go-arounds have the same cause as main's: ground traffic refuses the landing at
commitment, in the hours that main loses to a stalled queue. Either an aircraft ordered before the arrival on its way
off cannot give way in time, or one stands on its exit.

TASK-352 also tried two ideas, as switches on `task/352-idep-arrivals` `43cc8498`; read its commit message:
- `T352COMMIT`: an aircraft moving on the ground that will be past its wait point by the arrival's exit time does
  not refuse the landing. On seed 2 it let a lander stop with its tail on the runway (late-clear go-arounds).
- `T352SWAP`: the next arrival takes the first later exit that nobody stands in.

## Goal

With `T363=pk` on, bring go-arounds down to main's level or below, keeping TASK-363's gains. Use general rules
with cited sources. Count go-arounds by cause, before and after. Then switch `T363` on by default.

Rules to consider, measured and chosen with evidence:
- at commitment, plan the lander's exit and its way off against ground traffic, and order the ground aircraft
  behind the lander when it can still stop short;
- exit assignment (TASK-352's swap);
- hold departures and tows short of an exit that a committed lander needs (ICAO Doc 4444 7.10, runway incursion
  avoidance; CAP 493);
- the arrival release, so that an arrival is not committed toward an exit already blocked.

No lander may stop with its tail on the runway.

## Gates (owner ladder)

1. Heathrow 06:00–08:00 seed 1.
2. Seeds 1–5 against main:
   - completed up;
   - go-arounds not worse than main in sum;
   - overlaps 0;
   - `runwayConflictsReal` 0;
   - no gridlock.
3. Full days, seeds 1–3: Heathrow, Zurich (`--daily 730`) and Boston against main:
   - go-arounds not worse than main in sum per airport;
   - completed not worse;
   - London City day not worse.
4. Light tiers.

Main references are in `D:\cityflows-wt\330-pilot\R\`:
- Heathrow and London City: `t360\irm-p1..p5`, `irm-lhr-d1..3`, `irm-lcy-d1`;
- Zurich: `t360\irm-zrh-d1..3`;
- Boston: `t360\irm-bos-d1..2` and `t353\fo-bos-d3`.

Main since then (TASK-358 helipad rule, TASK-365) is identical on these runs, except that Heathrow peak seed 1 now
has 0 overlaps.
