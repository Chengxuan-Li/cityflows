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

## Result (2026-11-26)

**Rule** (`src/sim/aircraft.ts`, `trySpawnArrival`, `behindParked`, `stepOut`, `order`; on by default; the env
`T363=<letters>` picks them for the ladder, `p` and `k`, `T363=off` for the order before them):

1. **Step out of the landing order** (`p`). A queued arrival whose way to its stand passes an aircraft parked (or at
   its rest point) across it, with no movement admitted or requested, is not ordered: a new admission is refused, an
   admitted one is dropped together with the waits of others on it. The arrivals behind it are then not ordered to
   wait for it and land; it is ordered again once the way is clear. This is TASK-339's parked-blocker rule for
   departures at their stands (`refuseBehindParked`), applied to an arrival in the queue.
2. **Its place in the approach sequence** (`k`). Two queued arrivals to one runway end are ordered by their place in
   the approach sequence, the rank each had when first ordered (`seqRank`), which an arrival keeps while it steps
   out; with no step-out this is the order of admission, as before. A go-around or a runway change sequences it anew.

Citation: ICAO Doc 4444 (PANS-ATM, 16th ed.), 6.5.6.1.1: the approach sequence is set up to land the most aircraft
with the least average delay; 6.5.6.1.4: an aircraft in the sequence that holds for reasons of its own is cleared to
hold apart and re-sequenced so that the other holding aircraft can land. Our arrival holds in the air (as on main), not on the ground: the rule
removes its hold on the others, not its own wait.

Not taken (measured at the peak rung, seed 1 unless named; completed, landed/departed, go-arounds, overlaps):
- `p` alone (rank anew when ordered again): 137 (59/82, 5, 3). A re-ordered arrival ranks behind every queued
  arrival admitted meanwhile, and the head waits 2,770 s on a queued arrival behind it that waits on one ahead.
- `p` + queue order (`s`, TASK-352's `T352SEQ`): seeds 1–5 686 completed (main 676), landings 303 (288), but
  go-arounds 23 (18) and one `runwayConflictsReal` sample on seed 5: failed the gate.
- `p` also for parked aircraft with a departure or tow requested (`r`): 150 (62/93, 5, 0), as `ps`.
- A guard keeping an arrival from landing to park across the way of one stepped out ahead of it: on the fixture it
  met a ring between that one and the parked aircraft's departure; not needed at the gates, dropped.

**Counters** (behaviour-neutral): a queue head held behind a queued arrival ordered first now names that arrival's
own cause (`...behind:lowerRank>spacing`), and the bench's `arrivalCauses.steppedOut` gives the seconds queued
arrivals stood out of the order, by end and stand.

**Tests.** `tests/sim/aircraft-arrival-sequence.test.ts` on the fixture (`far`: a code E stand J east of K): with an
E190 parked at K across the B777's way to J, the E190 queued behind the B777 lands at once and the B777 lands once
K's aircraft has left; with `T363=off` the B777, ordered first, holds the E190 in the air until then.
`docs/architecture.md`: Order and Parked in the way.

**Gate ladder** (`D:\cityflows-wt\330-pilot\R\t363\`, `pk-*.json`; main: TASK-360's `irm-*` references; cells:
completed (landed/departed, go-arounds, overlaps, `runwayConflictsReal`, gridlock h, mean delay s)).

1. Heathrow 06:00–08:00 seed 1, `--checks`: main 143 (61/90, 5, 3, 0, -, 1,643) → 146 (61/90, 4, 0, 0, -, 1,733).
   With `T363=off` the bench JSON is identical to main's but for wall time and the counters (`off-p1`).
2. Seeds 1–5:

| Seed | Main | Branch |
|---|---|---|
| 1 | 143 (61/90, 5, 3, 0, -, 1,643) | 146 (61/90, 4, 0, 0, -, 1,733) |
| 2 | 130 (56/79, 2, 0, 0, -, 1,628) | 130 (56/79, 2, 0, 0, -, 1,628) |
| 3 | 133 (55/82, 0, 0, 0, -, 1,442) | 133 (55/82, 0, 0, 0, -, 1,442) |
| 4 | 134 (64/74, 4, 0, 0, -, 1,846) | 135 (66/74, 4, 0, 0, -, 1,891) |
| 5 | 136 (52/85, 7, 0, 0, -, 1,685) | 146 (65/82, 8, 0, 0, -, 1,897) |
| Sum | 676 (288/410, 18, 3, 0) | 690 (303/407, 18, 0, 0) |

   Landings up 15, completed up 14, go-arounds equal, overlaps 3 → 0, no real runway conflict, no gridlock: passed.
   Seeds 2 and 3 never meet the rule (identical runs). Seed 5's main loses its 08:00 hour to an arrival waiting on a
   parked aircraft (1,880 s at the head); landings 08:00–09:00 11 → 24.
3. Full days:

| Day | Main | Branch |
|---|---|---|
| Heathrow 1 | 849 (427/423, 21, 0, 0, -, 14,350) | 871 (439/434, 21, 0, 0, -, 14,163) |
| Heathrow 2 | 813 (415/399, 15, 0, 0, -, 14,185) | 871 (448/425, 19, 0, 0, -, 11,995) |
| Heathrow 3 | 757 (390/369, 15, 0, 0, -, 16,064) | 827 (418/409, 28, 0, 3, -, 12,818) |
| Zurich 730, 1–3 | 729 / 727 / 746 | identical |
| Boston 1, 2 | 992 / 968 | identical |
| Boston 3 (`t353\fo-bos-d3`) | 996 | identical |
| London City 1 | 150 | identical |

   Heathrow: completed +150 over the three days, landings +73, take-offs +77, diversions 112/145/162 → 104/106/126.
   Go-arounds 51 → 68, and day 3 has 3 samples of a real runway conflict (see below).

   The 3 real runway-conflict samples (21:07:36–38, logged by the bench's new `RUNWAY` line, `pkl-lhr-d3.err`) are
   three departures lined up on 27R at once (G-LCJQ, G-FQWK, G-UUCO): TASK-360's multiple line-up, which the
   checker exempts for two aircraft in line, not for this triple. It is departure-side; this run only reaches it.
   The extra go-arounds come with the extra landings in the hours main loses to a stalled queue (day 3: main lands
   1, 4 and 13 in the 06:00, 10:00 and 17:00 hours, the branch 21, 23 and 27; go-arounds per landing 4.1 → 5.2 %
   over the three days); their causes are the same commitment refusals by ground traffic on the way off as on main.

**Verdict.** Peak rung passed; full-day rung not clean (go-arounds 51 → 68 on Heathrow, the departure-side triple
line-up on day 3). The rules stay behind the switch, **off by default** (identical to main); `T363=pk` turns them on.
`docs/architecture.md` is unchanged; with the switch on, its Order paragraph would gain "two queued arrivals to one
runway end go in their approach sequence", and Parked in the way the arrival's step-out.

**Head of the 27L queue held, by cause** (seconds; a hold behind a queued arrival ordered first is charged to that
arrival's own cause where the counter names it, which main's references predate):

| Cause | Peak s1 main | Peak s1 branch | LHR days 1–3 main | LHR days 1–3 branch |
|---|---|---|---|---|
| Final spacing | 5,360 | 5,035 | 91,020 | 98,525 |
| Ground traffic on its way off | 2,015 | 2,220 | 31,560 | 44,310 |
| Crossing gaps | 1,230 | 1,695 | 29,140 | 28,635 |
| Behind a queued arrival ordered first (unattributed) | 0 | 0 | 21,165 | 0 |
| Bookings | 650 | 700 | 16,155 | 17,120 |
| A parked aircraft across its way | 770 | 0 | 10,195 | 0 |
| Pushback into its stand | 390 | 450 | 1,195 | 1,760 |
| Stepped out (itself waiting, others not held) | 0 | 245 | 0 | 8,895 |
| Other | 185 | 330 | 2,135 | 4,770 |

The holds that stopped the sequence (a parked aircraft across the head's way, and those behind it ordered after it)
are gone; what is left is spacing and ground traffic on the way off, which now take more of the day because more
arrivals land.

**Landings per hour** (27L, bench `landings`): peak 21 / 18.5 / 19.5 / 22.5 / 20.5 → 20.5 / 18.5 / 19.5 / 22.5 /
20.5; by landing hour, summed over seeds 1–5, 06:00 110 → 110, 07:00 97 → 96, 08:00–09:00 (drain) 74 → 89. Full
days 17.7 / 17.2 / 16.1 → 18.2 / 18.5 / 17.3. By hour, main's stalled hours go: day 2 11:00 5 → 27, day 3 06:00 1 → 21, 10:00 4 → 23, 17:00 13 → 27.

**Arrivals that waited, and where.** The rule adds no ground holding: an arrival whose way in is blocked waits in the
air (queued), as on main; it no longer holds the others. Stepped out (bench `steppedOut`): peak seed 1 st:31169
1,740 s (the TASK-353 stand behind st:31168), other seeds 5–15 s at 244, 248, 249, 251, 412, 432, TA2; Heathrow
days: st:31169 7,735 / 1,835 / 5,715 s, stand 232 1,840 s and 412 490 s on day 2, the rest 5–10 s. Arrivals that
stood more than 60 s on the ground (surface waits): peak 63 → 66 over seeds 1–5, days 31 / 39 / 35 → 35 / 30 / 32;
total ground wait on the days 115 / 122 / 113 → 87 / 108 / 107 min. The long waits at st:31169 are the stand
allocation pairing it with a neighbour whose parked body is across its way in (TASK-353's follow-up for
`standPairSafe`); a reassignment to a free stand of its kind would end them and is not part of this change.

**Tiers** (switch on, before the default was set off): `npm run check` passed (306 files, 2,188 tests passed, 3
skipped; build ok); `test:city` 77 files passed (291 tests, 1 skipped); `test:traffic:light` 5 passed, 1 expected
fail; `test:e2e:light` 63 passed (ports 5388/5389). With the default off, `npm test` passes again (306 files, 2,188
tests).
