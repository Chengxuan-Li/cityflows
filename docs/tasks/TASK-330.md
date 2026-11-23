# TASK-330 — Departures push back without waiting for distant traffic

Status: in progress 2026-11-23. The owner said "aircrafts do not push back from gate, maybe our time window rule is too
strict?", then approved the plan with "yes but try out on lightweight tests first to validate efficacy".
Proposed owner: Claude subagent (Opus 5.5, high). Branch `task/330-start-rule`, worktree `D:\cityflows-wt\330`, ports
5530 / 5630. Base: main 771235f.

## Finding (lead, 2026-11-23, real sim, main 771235f, seed 1, full day)

Departures wait at their stands far longer than at real airports. The bench reports this as `departureStages.startWaitS`
(mean, s); per-movement values are in the output's `departures[].startWaitS`.

| Airport | Mean start wait, 6ede796 (327+328) | Now, 771235f (+329) | Surface wait, before → now |
|---|---|---|---|
| Boston | 1,053 s | 1,291 s | 484 → 173 s |
| Zurich 730 | 2,260 s | 2,582 s | 666 → 155 s |
| Heathrow | 3,634 s | 6,657 s | 743 → 294 s |

At its worst, Heathrow has 84 aircraft at stands at once waiting for a start grant. The longest waits are 5–6 h.
TASK-329 moved the waiting from taxiways to stands. Some of that is intended, but not this much. The peak windows show
it too. On 6ede796, Zurich 730 from 06:00 to 10:00 has a mean start wait of 620–1,120 s and a p95 of 2,000–3,200 s.

Main has no time-window routing; TASK-325's routing mock is bench-only. Four things keep departures at their stands. All
are in `src/sim/aircraft.ts`:

1. **Whole-route admission.** A departure starts only if `order()` can order its entire route to the runway.
2. **Waiting for unstarted aircraft (TASK-329, `waitsForUnstarted`).** A departure does not start while it would wait
   for a queued arrival or a parked aircraft. A queued arrival counts however far out it is. At Heathrow about 80
   arrivals are holding, and almost every departure route meets one of them.
3. **No aging.** A starter goes before every departure still at its stand (`passing`), however long that departure has
   waited. TASK-329 tried a 5-minute guard and dropped it because Boston fell from 817 to 658 completed. Its report gave
   Boston's longest start wait as 6,376 s, against 4,122 s with TASK-327 alone.
4. **A feedback loop.** Held departures keep their stands, so arrivals get no stand and hold in the air. Rule 2 then
   makes those holding arrivals block more departures.

## Goal

Departures start within minutes when their way out is clear, as at a real airport. No new deadlocks, overlaps or runway
conflicts. Try the two smaller changes first:

- **B — arrival horizon.** A departure, before it starts, waits only for queued arrivals that matter now: an arrival
  that has committed to land, or one that will reach the conflict point within about the time the departure needs to
  get there, plus a margin. An arrival far out does not block a pushback. When it comes, it is ordered as it is today
  when an arrival starts.
- **C — no overtaking after a long wait.** Once a departure has waited at its stand for N minutes with a request (try
  10; 15 if 10 costs throughput), a later starter whose route conflicts with it does not go before it. It waits for that
  departure, or does not start. Be deterministic: count elapsed sim time, and break ties by rank.

Keep what TASK-312, 327, 328 and 329 fixed: dead ends, pushback against arrivals, runway crossings, intersections, the
re-route at a hold, moving aircraft never waiting for unstarted ones, and London City's clean day.

Only if B and C together clearly fall short: consider **A**, which clears only the pushback area and the first stretch
to a safe waiting point, and reserves the rest as the aircraft goes. Do not build A without reporting to the lead first.

## Phase 1 — lightweight pilot (stop and report after it)

The pilot answers whether the change works before any full day or full gates run. Each run takes a few minutes. Use
`bench/airside-delay.ts --checks` on these windows:

- Zurich at 730: 06:00–10:00, seeds 1–3 (`--from 6 --to 10 --daily 730`);
- Heathrow: 05:00–09:00, seed 1;
- Boston: 06:00–10:00, seed 1.

Run them in parallel where the machine allows. `D:\cityflows-wt\lead-evidence\quick-airports.sh` shows the command
form. Measure the base (771235f), then **B**, **C** and **B + C**. Give one table per airport with:

- completed / scheduled;
- mean, p95 and max of `departures[].startWaitS`;
- mean surface wait;
- `peakStuck5`, `endStuck5`, `endQueued`, go-arounds and `gridlockH`;
- overlaps and runway conflicts (both must stay 0).

Add the synthetic tests (see Gates) in this phase. They are the lightweight check of each rule.

Then **stop and report to the lead**: the tables, which variant you would keep, and why. If neither B nor C lowers the
start waits at Heathrow and Zurich without losing completed movements, say so. Do not stack more rules. Commit the
pilot state on your branch first, so it can be inspected.

## Phase 2 — full verification (only after the lead says go)

- Full days, seeds 1–3: Heathrow (1,300), Zurich at 730, Boston (1,000), London City (schedule). Use the same table
  plus taxi times. Targets:
  - mean start wait under about 600 s, and a p95 well under 30 min where the runways have the capacity;
  - completed movements not below base;
  - no new gridlocks;
  - overlaps and runway conflicts 0.
- Airports batch merge rule (existing cities unchanged, hashes in `docs/plan.md`).
- `bundled-airport-load`: re-pin only if a startup state changes, and say why.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Scope

`src/sim/aircraft.ts`: the start grant (`waitsForUnstarted`, `passing`, `yieldsTo`, the start path) and the
request-time bookkeeping C needs. Tests go in `tests/sim/`. No schema change. Leave `bench/` alone, unless you need an
extra summary field (p95 or max start wait). Then add it and say so.

## Gates (tests)

- Synthetic: a departure at its stand whose route meets a queued arrival still far out starts, and it is clear of
  the arrival when the arrival lands.
- Synthetic: a departure waiting longer than N is not overtaken by a later starter with a conflicting route.
- The TASK-329 tests and `tests/sim/aircraft-checks.ts` still pass (no body overlap, no runway conflict).

## Report

Phase 1: a message to the lead with the tables. Phase 2: the commit body.
