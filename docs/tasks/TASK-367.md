# TASK-367 — Heathrow: ground aircraft ordered before a queued arrival on its way off (admission order)

Status: started 2026-11-26 (owner defaults; airside: merge on gates, realism changes allowed with a cited rule).
Owner: Claude subagent (Opus 5.5). Base: `task/366-commit-goarounds` `e78c618b` (main `d67ad853` + TASK-363 +
TASK-366, every switch off, identical to main).

## Finding (TASK-366, 2026-11-26)

With `T363=pk` on, Heathrow full days 1–3 have 68 go-arounds against main's 51. By cause:

| Cause | Main days | T363 days |
|---|---|---|
| Departure ordered first | 24 | 29 |
| Tow ordered first | 11 | 13 |
| Arrival ahead on the same way off | 13 | 15 |
| Arrival standing in the way off | 3 | 9 |
| Other | 0 | 2 |

TASK-366's holds at release and commitment (`T366=h/p/a/s`) cut go-arounds but lose landings: peaks 666 against
main's 676. At a saturated runway a go-around hands its slot to the next arrival, and a hold loses that slot.

The go-arounds come from orders set at admission, often an hour before landing. A departure or tow ordered before a
queued arrival on the arrival's way off is let onto the stretch before a 27L crossing. That arrival's own runway
booking then holds it at the crossing, so it stands on the exit when the arrival commits. TASK-330 set the admission
order against queued arrivals; TASK-340 made it ring-free.

## Goal

Fix the ordering, not the holds. A ground aircraft is ordered before a queued arrival on a shared stretch only if it
can clear that stretch, including the crossing at its end, before the arrival needs it. Otherwise it is ordered
after the arrival and waits short of the stretch. Cite the rule, for example: taxi clearances limited to a holding
point clear of the runway exits a landing aircraft will use (ICAO Doc 4444 7.6; CAP 493 Section 2, Chapter 1).

Keep the TASK-340 ring-free ordering and the TASK-339 parked-blocker rules intact. No lander may stop with its tail on
the runway (TASK-366's `tailOnRunway` counter). Measure with `T363=pk`, and without it too. If it passes, switch
`T363` (and your rule) on by default.

## Gates (owner ladder)

1. Heathrow 06:00–08:00 seed 1, `--checks`.
2. Seeds 1–5 against main:
   - completed up in sum;
   - go-arounds not worse than main in sum;
   - overlaps 0, `runwayConflictsReal` 0, no gridlock, `tailOnRunway` 0.
3. Full days, seeds 1–3: Heathrow, Zurich (`--daily 730`) and Boston against main:
   - go-arounds not worse in sum per airport;
   - completed not worse;
   - London City day not worse.
4. Light tiers; re-pin `tests/traffic/bundled-airport-load.test.ts` if a default changes.

Main references are in `D:\cityflows-wt\330-pilot\R\`: `t360\irm-p1..p5`, `irm-lhr-d1..3`, `irm-lcy-d1`,
`irm-zrh-d1..3`, `irm-bos-d1..2`, `t353\fo-bos-d3`. TASK-366's runs (with the cause counters) are in `t366\`.

Report go-arounds by cause, before and after, as TASK-366 did.
