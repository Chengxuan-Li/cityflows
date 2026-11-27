# TASK-363 — Heathrow arrivals: an arrival waiting for its stand does not hold the landing sequence

Status: started 2026-11-26 (owner defaults; airside: merge on gates, realism changes allowed with a cited rule).
Owner: Claude subagent (Opus 5.5). Base: main after TASK-360.

## Finding

After TASK-360, departures at Heathrow are no longer the limit. Arrivals are: about 22–24 landings an hour on 27L,
held by the head of each end's arrival queue.

**TASK-352's counters** (`arrivalCauses`, on `task/352-idep-arrivals` `43cc8498`) on main, Heathrow 06:00–08:00 seed
1, give the seconds the 27L queue head was held, by cause:

| Cause | Seconds |
|---|---|
| Final spacing | 4,560 |
| A queued arrival behind it ordered first (admitted earlier while its own stand was still taken) | 1,320 |
| Crossing gaps | 1,225 |
| A parked aircraft in its way | 715 |
| Bookings | 680 |
| Tows and departures in its way off | ~1,500 |

**TASK-360's full-day seed 3** finished 777 → 757. From 06:00 the head of the 27L queue waited for a queued arrival
that had been admitted earlier and ordered ahead of it: 4,700 s by 08:00, 9,380 s over the day.

**TASK-353, seed 1:** an arrival for remote stand `st:31169` waited for an aircraft parked at `st:31168` across its
way in. As the head of its end's queue, it held every later arrival to that end for over an hour. TASK-358 showed
that its stand-pairing fix does not cover this case.

## Goal

An arrival that cannot yet reach its stand must not hold the landing sequence. Make that a general rule with a cited
source. In practice, approach control sequences arrivals by their order on approach. An aircraft whose stand is
taken lands, vacates, and waits on the ground: at a holding point or remote holding area, or it is given another
stand. It does not hold the aircraft behind it in the air.

Options, to be measured; pick with evidence:
- The landing order follows the approach sequence, not the order of admission.
- An arrival whose stand is not ready lands and waits at a holding point or remote holding area off the taxiways it
  would block.
- It is reassigned to a free stand of its kind (TASK-353's nearest-own-kind rule).
- Its admission is delayed before it joins the queue, without blocking those behind.

Keep the TASK-340 ring-free ordering and the TASK-339 parked-blocker rules intact. TASK-352's `T352SEQ` (queue order)
blocked the queue behind a head waiting on a parked aircraft. Learn from it, and reuse its counters.

## Gates (owner ladder)

1. Heathrow 06:00–08:00 seed 1, `--checks`.
2. Seeds 1–5 against main after TASK-360:
   - landings up;
   - completed up in sum;
   - go-arounds and overlaps not worse;
   - `runwayConflictsReal` 0;
   - no gridlock.
   Main references: `D:\cityflows-wt\330-pilot\R\t360\irm-p1..p5.json`.
3. Full days, seeds 1–3, against main. References in `D:\cityflows-wt\330-pilot\R\t360\`:
   - Heathrow: `irm-lhr-d1..3`;
   - Zurich (`--daily 730`): `irm-zrh-d1..3`;
   - Boston: `irm-bos-d1..2`, plus `t353\fo-bos-d3`;
   - London City day: `irm-lcy-d1`.
4. Light tiers. City hashes must be identical.

Report:
- holds of the queue head by cause, before and after;
- landings per hour;
- how many arrivals waited on the ground, and where.
