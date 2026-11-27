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

## Result (2026-11-26)

**Verdict: not passed. Every rule stays behind the switch `T366=<letters>`, off by default, and `T363` stays off
(identical to main).** No variant reached the day rung. Each one that cut go-arounds at the peak rung also cut
landings, and completed fell below main's 676 on seeds 1–5. The pattern holds across the whole ladder. With the
27L queue always full, a go-around gives the slot to the next arrival. Holding ground traffic, or holding the
arrival back, costs that slot instead.

**Rules measured** (`src/sim/aircraft.ts`, `t366Rules`; all with `T363=pk`):

- `h`: hold short at release. When an arrival appears, a ground aircraft it is ordered after, where they meet before
  its tail is off the runway (ordered first while the arrival queued), gives way to it. This applies only if the
  ground aircraft can still stop short, it is not sure to be past in time, and the arrival does not wait for it
  through others. "Sure to be past" means moving, with no runway hold and no wait before it is past, by the arrival's
  runway exit time (TASK-330's landed-leader test, `leaderPastS`). If it can no longer stop, the arrival does not
  appear (`hold:`).
- `p`: hold short before commitment. The same rule, applied each second from 30 s before the landing commitment
  (`PRECOMMIT_S`).
- `a`: leader on the same way off. An arrival does not appear while an arrival ahead to the same runway, which it
  follows on its way off, is not sure to be past in time (the commitment's `leaving` test, made at release;
  `leader:`).
- `s`: another exit at commitment. An arrival whose way off cannot be ordered at commitment takes the first other exit
  that meets all of these: the same flight path to touchdown, a runway booking that fits, an order like the one at its
  release, a successful commitment, and no added runway crossing. `order` gains `afterM`: beyond the arrival's tail-off
  point it waits for one that cannot stop, and it never puts a lander's wait short of its own tail-off point.

Citations:
- ICAO Annex 2, 3.2.2.5.1: aircraft on the ground give way to aircraft landing or in the final stages of an approach
  (`h`, `p`).
- CAP 493 (MATS Part 1, Ed. 12), Section 2, Chapter 1, 19B.1(2) and 19B.2(4), from CAP 493/SI/2025/01, which
  implements ICAO Doc 4444, 7.10.3.1: the controller may ask a landing aircraft to vacate at a specified exit,
  considering the location of exits (`s`).
- ICAO Doc 4444, 6.5.6.1.1, as for TASK-363 (`a`).

Not taken:
- Deferring the commitment past `DECISION_S`. CAP 493, Section 3, 15.1(2) has a missed approach when no landing
  clearance is received by 2 NM. Our 30 s (about 1.1 NM) is already inside that.
- A hold-short at the ground aircraft's last place to stop. It fired 0–2 times per peak. The aircraft concerned are
  either far off or already inside the conflict.
- `a` with a TASK-363 step-out: seed 5 gave 131.

**Counters** (behaviour-neutral):
- `arrivalCauses.tailOnRunway` (fleet and bench): seconds that landed aircraft stand with their tail before the
  vacating point of their way off, and how many aircraft.
- `heldShort` and `exitSwaps` in the order counters.

The pk base already has one such stop: peak seed 5, an A20N for 12 s, held by a claim 26 m short of vacating, behind a
chain of arrivals standing on the exit. This is not new with these rules. `p` keeps it at 12 s. The far-exit swaps
before the crossing guard made it 85 s. The `s` guard against added runway crossings came after the swap runs: unguarded
swaps took exits 1.2 km further on, whose way in crosses 27R, and the swapped arrival held there in the departures' way.

`landingUses` moves the landing booking out of `trySpawnArrival` (same values). With every switch off, the Heathrow
06:00–08:00 seed 1 bench JSON equals the base's (`off-p1` against `main-p1`, run on the base `ba580b5f`), except
`wallS` and the new counter.

**Go-arounds by cause, before** (Heathrow; pk days are TASK-363's `pk-lhr-d1/d2` and this base's `dbg-lhr-d3`, which
is identical to `pk-lhr-d3` except that its 3 real-conflict samples are gone after TASK-365):

| Cause (commit refused by) | Main days 1–3 | `T363=pk` days 1–3 | Main peaks 1–5 | `T363=pk` peaks 1–5 |
|---|---|---|---|---|
| Departure ordered first, on its way off | 24 | 29 | 2 | 1 |
| Tow ordered first | 11 | 13 | 3 | 2 |
| Arrival ahead on the same way off (wait) | 13 | 15 | 8 | 11 |
| Arrival standing in its way off (claim) | 3 | 9 | 5 | 4 |
| Other (late, late clear) | 0 | 2 | 0 | 0 |
| Total | 51 | 68 | 18 | 18 |

The debug pass (`dbg-*`, since removed) found three things:
- At commitment, almost every refused ground aircraft had been ordered first at the arrival's admission, often an
  hour before.
- The departures and tows concerned run along the taxiway that the exit joins, toward a 27L crossing hold inside that
  stretch. They stop there for a crossing that the arrival's own booking holds back.
- The arrival leaders stop just past their own tail-off point behind a chain on the exit, leaving the follower no
  room.

**Peak rung** (`D:\cityflows-wt\330-pilot\R\t366\`; cells: completed (landed/departed, go-arounds, overlaps,
`runwayConflictsReal`, gridlock, mean delay s)). Main is TASK-360's `irm-*`; main now has 0 overlaps on seed 1 (`main-p1`).

| Seed | Main | `T363=pk` | `pk` + `p` | `pk` + `h` |
|---|---|---|---|---|
| 1 | 143 (61/90, 5, 3→0, 0, -, 1,643) | 145 (60/90, 4, 0, 0, -, 1,727) | 141 (57/88, 3, 0, 0, -, 1,689) | 146 (61/90, 4, 0, 0, -, 1,727) |
| 2 | 130 (56/79, 2, 0, 0, -, 1,628) | 130 (56/79, 2, 0, 0, -, 1,628) | 126 (54/80, 1, 0, 0, -, 1,590) | 118 (49/75, 1, 1, 0, -, 1,740) |
| 3 | 133 (55/82, 0, 0, 0, -, 1,442) | 133 (55/82, 0, 0, 0, -, 1,442) | 126 (56/74, 1, 0, 0, -, 1,448) | 129 (56/76, 1, 0, 0, -, 1,462) |
| 4 | 134 (64/74, 4, 0, 0, -, 1,846) | 135 (66/74, 4, 0, 0, -, 1,891) | 127 (61/70, 1, 0, 0, -, 1,741) | 127 (61/71, 1, 0, 0, -, 1,730) |
| 5 | 136 (52/85, 7, 0, 0, -, 1,685) | 146 (65/82, 8, 0, 0, -, 1,897) | 146 (65/82, 8, 0, 0, -, 1,897) | 146 (66/81, 8, 0, 0, -, 1,918) |
| Sum | 676 (288/410, 18) | 689 (302/407, 18) | 666 (293/394, 14) | 666 (293/393, 15) |

Both fail "completed up" (666 < 676). `h` also has an overlap on seed 2. Other variants, one or two seeds each, against
`T363=pk`:

| Variant | Seed: completed (landed/departed, go-arounds) |
|---|---|
| `a` | 5: 136 (57/84, 3) against 146 (65/82, 8) |
| `p` + `a` | 5: 137 (59/82, 1) |
| `h` + `a` | 5: 137 (57/84, 2) |
| `h` + `s` (unguarded swap) | 1: 142 (57/93, 0); 2: 122 (51/80, 0, 1 overlap); 4: 126 (60/70, 1); 5: 138 (63/78, 3) |
| `s` (unguarded) | 4: 115 (63/57, 1); 5: 138 (64/78, 3) |
| `h` before the ring guard | 1: 150 (59/96, 2) |
| `s` (with crossing guard) | 4: 123 (59/67, 2), one swap; 5: 146 (65/82, 8), no exit fits |

Every variant that removes the arrival-leader go-arounds on seed 5 (`a`, `p` + `a`, `h` + `a`) loses 8–9 landings. The
held arrival keeps the head of the 27L queue for about 1,000 s (`leader:`). Seed 3 has no go-arounds, and `p` still
loses 7 there: the holds themselves cost throughput.

**Day rung:** not run. The peak rung did not pass.

**Tiers** (switches off, so identical to main):
- `npm run check`: passed (307 files passed, 1 skipped; 2,202 tests passed, 2 skipped; build ok).
- `test:city`: 77 files passed (291 tests, 1 skipped).
- `test:traffic:light`: 5 passed, 1 expected fail.
- `test:e2e:light`: 63 passed (port 5384).
- `tests/traffic/bundled-airport-load`: 4 passed (pins unchanged, since no default changed).

New test: `tests/sim/aircraft-landing-commitment.test.ts`. On the fixture, with each switch and all together, both
arrivals land, the departure leaves, no bodies overlap and no tail stands on the runway.

**Next.** At a saturated runway a go-around is close to free in throughput, so "fewer go-arounds" and "completed up"
pull against each other at Heathrow. The go-arounds themselves come from orders set at admission, long before
landing. A ground aircraft ordered before a queued arrival on its way off is let onto the stretch before a 27L crossing
hold, then held there by that same arrival's booking. Fixing that ordering (TASK-330's admission order against
queued arrivals), rather than adding holds at release or commitment, looks like the next lever.
