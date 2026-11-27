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

## Result (2026-11-26)

**Verdict: not passed at the peak rung. The rule stays behind the switch `T367=c`, off by default, and `T363`
stays off (both identical to main).** With `T363=pk`, the rule removes the ground-caused go-arounds it targets
(tows and departures 3 → 1 over peaks 1–5, and the fixture case). It costs landings, though: completed falls
690 → 654 against main's 676, and go-arounds rise 18 → 21, because arrival-against-arrival go-arounds rise. Seed 5
also has one lander standing 192 s with its tail on the runway. The day rung was not run.

**Finding, confirmed** (debug tags on each wait, `pk` Heathrow day 3 to 16:00, run on this base and since removed): 13
go-arounds came from ground aircraft (7 departures, 6 tows). 11 of their orders were set at the arrival's
admission: the ground aircraft was admitted first, often 15–60 min before the landing. The other 2 were set at a
departure's start, past a queued arrival beyond TASK-330's horizon. In 12 of the 13, the ground aircraft's way past
the conflict ran through an ungranted 27L hold inside the arrival's way off. TASK-340's `holdClear` had extended
its pass point beyond that hold. It stood at the hold (`<gate`) or was still moving toward it when the arrival
committed.

**Rule measured** (`src/sim/aircraft.ts`, `crossingIn`, `crossingOrder`, run with the progressive order every 5 s):
- **Scope.** A ground aircraft ordered before an arrival. The arrival is either on approach and not yet committed,
  or the next queued for its end (its commitment reckoned as if it appeared now). The ground aircraft's way past
  their conflict ends at an ungranted runway hold where its body, standing, is in that arrival's way off before
  the tail-off point.
- **Keeps its place** only if it can reach the hold (at taxi turn speed, or tow speed) and cross before the
  arrival's commitment, with the crossing fitting the runway's bookings at that time.
- **Otherwise it is ordered after the arrival** and waits short of the stretch, provided it can still stop short,
  closes no ring of waits (else TASK-340's `openChain`), and the arrival will not park across its way (TASK-339).
- **Gap.** Held short, it asks for its crossing gap from where it stands (TASK-312's gap between arrivals). It does
  so only while it waits for no queued arrival and stands for nothing but an arrival.

Citation: taxi clearances limited to a holding point clear of the runway exits a landing aircraft will use (ICAO
Doc 4444, 7.6; CAP 493, Section 2, Chapter 1), as the contract names them. The sources were not re-read in this task.

Counters (behaviour-neutral): `crossShort` among the order counters; the bench JSON gains `order` (all order
counters at the end), and its `RUNWAY` log gives each aircraft's type, position and heading. With the switch off, the
Heathrow 06:00–08:00 seed 1 bench JSON (`t367\off-p1`) equals main's (`t366\main-p1`), apart from `wallS`, `order`
and TASK-366's `tailOnRunway` counter.

**Runway checker** (`tests/sim/aircraft-checks.ts`, `exemptRunwayPair`). Two departures lined up on one end now
count as in line along either aircraft's heading, not only the front one's. On peak seed 1, the first variant had 5
`runwayConflictsReal` samples (08:42:29–33). G-HHOE was lined up on 27R at x = 1268. G-IGIT was swinging onto 27R
1.1 km ahead of it, at an intersection, with a heading of −0.35 to −1.12 rad. Measured along the turning aircraft's
heading, the pair did not look in line. This is TASK-360's multiple line-up, not a conflict. The test is in
`tests/sim/runway-exemptions.test.ts`. Main's references have 0 samples either way.

**Test** (`tests/sim/aircraft-crossing-order.test.ts`). The fixture gains `north`: stand N north of the runway,
reached by crossing at the x = −300 connector, the one landings on 27 vacate by. A B738 is towed from L1 to N, ordered
before two B738 landing on 27 for C1 and C2. With the switch off, one arrival goes around (`tow-moving` with arrivals
requested at 75 s, `tow-still<gate` at 105 s). With `T367=c`, the tow is ordered after the first arrival
(`crossShort` 1). Both land, the tow arrives, there are no go-arounds and no overlaps, and no tail stands on the
runway.

**Peak rung** (Heathrow 06:00–08:00, `--checks`, `D:\cityflows-wt\330-pilot\R\t367\`; cells: completed (landed/departed,
go-arounds, overlaps, `runwayConflictsReal`, `tailOnRunway` s/aircraft, `crossShort`)). Main is TASK-360's `irm-*`,
`T363=pk` is TASK-363's `pk-*`. Neither has the tail counter; TASK-366 found one 12 s stop on `pk` seed 5.

| Seed | Main | `T363=pk` | `pk` + `T367=c` (`c3-*`) |
|---|---|---|---|
| 1 | 143 (61/90, 5, 3, 0) | 146 (61/90, 4, 0, 0) | 145 (61/89, 3, 0, 0, 0, 1) |
| 2 | 130 (56/79, 2, 0, 0) | 130 (56/79, 2, 0, 0) | 123 (51/77, 3, 0, 0, 0, 2) |
| 3 | 133 (55/82, 0, 0, 0) | 133 (55/82, 0, 0, 0) | 127 (54/77, 5, 0, 0, 0, 2) |
| 4 | 134 (64/74, 4, 0, 0) | 135 (66/74, 4, 0, 0) | 128 (60/72, 3, 0, 0, 0, 4) |
| 5 | 136 (52/85, 7, 0, 0) | 146 (65/82, 8, 0, 0) | 131 (57/78, 7, 0, 0, 192/1, 2) |
| Sum | 676 (288/410, 18, 3, 0) | 690 (303/407, 18, 0, 0) | 654 (283/393, 21, 0, 0) |

Gates:
- completed up in sum: failed (654 against 676);
- go-arounds not worse: failed (21 against 18);
- overlaps 0 and `runwayConflictsReal` 0: passed;
- no gridlock: passed;
- `tailOnRunway` 0: failed (seed 5, 192 s).

**Go-arounds by cause, peaks 1–5** (`pk` from TASK-366's cause-counted `dbg-p1/p2/p4`, `base-p3`, `pkt-p5`, which
equal `pk-*`):

| Cause (commit refused by) | Main | `T363=pk` | `pk` + `T367=c` |
|---|---|---|---|
| Arrival ahead on the same way off (wait) | 8 | 11 | 12 |
| Arrival standing in its way off (claim) | 5 | 4 | 5 |
| Departure ordered first (wait) | 2 | 1 | 1 |
| Tow ordered first (wait, claim) | 3 | 2 | 1 |
| Late clear | 0 | 0 | 2 |
| Total | 18 | 18 | 21 |

The rule fires 1–4 times per peak, yet every seed changes. Summed over seeds 1–5, the head of the 27L queue was held
52,230 s (`pk`) and 52,270 s (rule). Of that:
- final spacing: 25,305 → 23,310 s;
- crossing gaps: 9,450 → 10,790 s;
- TASK-363 step-outs: 245 → 1,855 s;
- ring opening: 1,460 → 2,320 s.

A tow held short delays the stand it frees, and its crossing gap is longer than at the hold, because the gap
includes its taxi from short of the stretch to the hold. Seed 2 has one tow's gap of 180 s holding the queue head
for 830 s.

Variants, each with `T363=pk`:
- `c1` (development, seeds 1–2): flips behind any queued arrival. It deadlocked a queue head behind a tow's gap: seed
  2 gave 124 (51/79, 3).
- `c2`: only the next queued arrival flips, and the gap waits until no queued arrival is waited for. Seeds 1–5 gave
  662 (285/402, 21).
- `c3`: adds `openChain` where a chain blocked the flip (seed 2 had 42 such refusals before the tow entered the
  stretch), and drops the gap while the aircraft stands for ground traffic. This is the one variant after the
  failure, and the one in the code.

`T367=c` without `T363` (`co-*`, against main), by seed:
- 143 (62/88, 3, 0, 0, 0, 1);
- 110 (41/74, 2, 0, 0, 0, 1);
- 126 (48/80, 5, 0, 0, 0, 2);
- 128 (60/72, 3, 0, 0, 0, 4);
- 131 (57/78, 7, 0, 0, 192/1, 2).

The sum is 638 (268/392, 20) against main's 676 (288/410, 18). By cause, against main:
- tow: 3 → 1;
- departure: 2 → 2;
- arrival: 13 → 15;
- late clear: 0 → 2.

Seeds 4 and 5 equal the `pk` + rule runs, so the 192 s tail stop does not come from TASK-363.

**Day rung:** not run.

**Next.** The order fix works where it applies: the fixture case, and ground-caused go-arounds 3 → 1 on peaks. The
cost is in the crossing itself. A crossing on the 27L exits needs a gap that covers the taxi through the exit
stretch, and with the queue always full that gap costs about one landing. This is the same slot a go-around costs.
The rule turns a go-around into a held arrival, and the knock-on changes (stands, step-outs, arrival chains on the
exits) are larger than the go-arounds saved. Two options might help:
- route these crossings by exits the arrivals do not use (as Heathrow uses its crossing taxiways);
- plan the crossing gap at the arrival's release, as part of the landing sequence.

**Tiers** (switch off, so identical to main apart from the runway checker's exemption):
- `npm run check`: passed (308 files passed, 1 skipped; 2,207 tests passed, 2 skipped; build ok).
- `test:city`: 77 files passed (291 tests, 1 skipped).
- `test:traffic:light`: 5 passed, 1 expected fail.
- `test:e2e:light`: 63 passed (port 5390).
- `tests/traffic/bundled-airport-load`: 4 passed (pins unchanged, since no default changed).
