# TASK-382 — Heathrow: A380 tows that wait 47–98 minutes and stand in the runway way off

Status: parked 2026-11-27 for the owner (branch `task/382-a380-tows` at `d6d29541`, main merged in, `T382` off). Full days (gate 3, owner follow-up): Heathrow 2,567 to 2,623 completed and go-arounds 71 to 68, Zurich, Boston and London City identical; but Heathrow day 2 has one real runway conflict (two departures lined up on 27R, a TASK-360 line-up, not a tow). Peaks: rule `rs` (tow routes avoid arrivals' exit taxiways; tows wait at the stand while a cleared arrival's exit path crosses their way) lifts peaks 689 to 724 and landings 302 to 333, and cuts tow-held 27L queue time 6,160 to 2,105 s, but go-arounds rise 18 to 21 (all behind the arrival ahead, 6.0% to 6.3% of landings). Fails the go-around gate; owner trade-off like TASK-363. Started by the lead in the 10 h unsupervised run; airside merges on gates. Owner: Claude subagent (Opus 5.5,
continuing TASK-376 and TASK-380). Base: main.

## Finding (TASK-376, TASK-380)

On Heathrow peak seed 1, two A380 tows (G-JVUS, G-TXFW) take 47–98 minutes from request to tow. While they wait or
move, they stand in the way off runway 27L and hold the arrival queue: landings 08:00–08:30 fell to 0–3 in the TASK-376
and TASK-380 variants. Main has the same tows. Every stand-pairing rule so far only moves the conflict onto them.

## Goal

1. Diagnose the tows on main, peaks 1–5 and days 1–3. For each tow over 20 minutes, or any that stands on a runway
   exit or its way off, give:
   - request time, tug arrival, start and park;
   - where it waits and what holds it;
   - which arrivals it delays.
2. Fix by rule. Options:
   - a tow does not wait or start on a runway exit's way off while arrivals are due on that runway;
   - vacating arrivals take priority over tows;
   - a tow's route keeps clear of the way off;
   - the tug's arrival and the tow's start are admitted only when the route is clear.

   Cite a source (ICAO Doc 4444 7.6 and 7.10; ICAO Doc 9476 SMGCS; CAP 168 or Heathrow towing instructions).
3. Keep the TASK-353 tow rules and TASK-363's sequence intact. Behind a switch while measuring; one variant allowed
   after the first.
4. Measure once with TASK-380's pairing on top (`T380=p`, branch `task/380-stand-pairing`).

## Scope

`src/sim/aircraft.ts`, `src/sim/flight-operations.ts`, `src/sim/ground-vehicles.ts` (tugs), `bench/airside-delay.ts`,
tests.

Out of scope: the city simulation, `src/network/**` geometry, gate floors, OSM edits, per-id curation.

## Gates

TASK-376's ladder:
- Heathrow peak seed 1 `--checks`;
- peaks 1–5 (689, go-arounds 18): completed not lower, go-arounds not higher;
- full days not worse: Heathrow 1–3, Zurich `--daily 730` 1–3, Boston 1–3 (re-run main), London City day 1;
- Munich and Freiburg hashes identical;
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Result (2026-11-27)

Parked. The first version and its one variant both fail gate 2 on go-arounds; the variant raises completed by 35.
Both stay on the branch behind `T382`, **off by default**; with the switch off the branch is main.

**Counter** (behaviour-neutral, bench `towLogs`). For each tow over 20 minutes, or one named in a refusal of an
arrival-queue head, it records:
- request, start and park times;
- its start refusals by reason;
- seconds standing still on the ground, by what it waits for and the edge it stands on;
- seconds a 27L queue head was refused naming it, and those arrivals.

With the switch off, every peak and days 1 and 2 match TASK-363's `m-*` JSON apart from wall time and the new field.
Day 3 differs only in one departure's taxi, by 2 s, as found in TASK-376. The
bench runs without ground vehicles, as every ladder reference does, so there is no tug: a tow starts when admitted.

**Diagnosis (main).** Times are summed over the run's tows. Per-tow rows (request, start, park, minutes, top refusals,
where it stood and why, head-held seconds, arrivals) are in `D:\cityflows-wt\330-pilot\R\t382\tows-main.tsv`.

| Run | Tows (over 20 min) | Request to start (min) | Standing on the ground (min) | of which at a runway hold | 27L head held naming a tow (s) | Arrivals held |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Peak 1 | 10 (10) | 478 | 87 | 5 | 485 | 2 |
| Peak 2 | 18 (16) | 852 | 52 | 7 | 1,740 | 9 |
| Peak 3 | 18 (16) | 456 | 123 | 11 | 1,795 | 12 |
| Peak 4 | 19 (19) | 1,159 | 90 | 4 | 1,240 | 11 |
| Peak 5 | 10 (9) | 759 | 23 | 3 | 900 | 7 |
| Day 1 | 34 (22) | 1,936 | 191 | 21 | 5,305 | 27 |
| Day 2 | 35 (31) | 1,802 | 150 | 15 | 2,980 | 17 |
| Day 3 | 30 (25) | 2,359 | 110 | 13 | 1,585 | 16 |

Where the time goes:
- Most of a tow's time is spent at its stand before starting: TASK-329's "would wait for a queued arrival"
  (`unstarted:queued`) and first-leg waits. A tow waiting there holds no arrival.
- The arrival holds come from tows on the ground near 27L's exits. Over the five peaks the queue head was held
  6,160 s naming a tow. By cause:
  - 2,165 s `exit:tow-moving`: a tow crossing, or past the point where it could give way, in the arrival's way off;
  - 2,150 s `exit:tow-still`: 1,640 s of it a tow standing at a crossing hold with its body in the way off;
  - 975 s `gap:tow-still`: a gap forced for a tow waiting at a hold;
  - 430 s `chain:tow-still`.
- Tows stood longest on exit taxiways. On N5E (`ae:33865`) they stood 4,402 s over the five peaks, waiting for
  approaching and exiting arrivals; on N5W (`ae:33309`, `ae:33869`) 2,453 s. They use the exits as part of their
  route.
- Peak seed 1's A380 G-TXFW (TA2 to 595, 117 min) also waits 888 s for helicopter G-VMKV on the helipad
  (`hl:34862`), the TASK-376 `h` case.
- Day 1's worst tow is A20N G-ULNG (218L to 411, 07:35 to 11:13). It held the head 1,660 s across 7 arrivals,
  1,100 s of it standing at a crossing hold in the way off.

**Rules** (switch `T382=<letters>`):
- `r`, route. A tow's route keeps off the taxiways arrivals have left the runway by, up to their tail clear of it
  (learned from each admitted landing), with the parked-aircraft route cost.
- `s`, start. A tow does not start while its way meets the way off of an arrival ordered to land, queued or on
  approach. An arrival that itself waits for the tow is excluded, or neither would move.
  - The ring was found on the test fixture after the first `rs` measurement and fixed. The five `rs` peaks re-run
    with the fix match the first runs exactly.
- Sources, by name and section, not re-read: ICAO Doc 4444 7.6 and 7.10 (aerodrome control keeps the way off clear
  for landing traffic; towed aircraft are cleared by it), and ICAO Doc 9476 (SMGCS), routes planned clear of the
  runway exits in use.
- TASK-353's tow rules and TASK-363's sequence are unchanged.

**Gate 1, peak seed 1, `--checks`.** Cells: completed (landed/departed, go-arounds, overlaps,
`runwayConflictsReal`, gridlock h, mean delay s).

| Run | Main | Branch |
| --- | --- | --- |
| `r` | 145 (60/90, 4, 0, 0, -, 1,727) | 146 (62/92, 8, 0, 0, -, 1,653) |
| `rs` | 145 (60/90, 4, 0, 0, -, 1,727) | 155 (66/95, 4, 0, 0, -, 1,776) |

**Gate 2, peaks seeds 1–5** (main `t363\m-p1..p5`). Cells: completed (landed/departed, go-arounds).

| Seed | Main | `r` | `rs` | `rs` + `T380=p` |
| --- | --- | --- | --- | --- |
| 1 | 145 (60/90, 4) | 146 (62/92, 8) | 155 (66/95, 4) | 151 (64/93, 6) |
| 2 | 130 (56/79, 2) | 134 (59/82, 5) | 137 (62/84, 6) | 137 (62/84, 6) |
| 3 | 133 (55/82, 0) | 138 (61/85, 2) | 143 (66/81, 0) | 143 (66/81, 0) |
| 4 | 135 (66/74, 4) | 132 (65/71, 6) | 143 (71/75, 6) | 143 (71/75, 6) |
| 5 | 146 (65/82, 8) | 145 (65/85, 4) | 146 (68/81, 5) | 144 (67/82, 6) |
| **Sum** | **689, go-arounds 18** | **695, 25: fail** | **724, 21: fail** | **718, 24: fail** |

Every run had zero overlaps, zero real runway conflicts and no gridlock.

| Sum over the 5 peaks | Main | `r` | `rs` | `rs` + `T380=p` |
| --- | ---: | ---: | ---: | ---: |
| Landings | 302 | 312 | 333 | 330 |
| Take-offs | 407 | 415 | 416 | 415 |
| 27L head held naming a tow (s) | 6,160 | 4,125 | 2,105 | 1,975 |
| Stepped-out time (s) | 1,790 | 2,505 | 1,795 | 0 |

`rs` is the better rule. Completed rises 35 and landings 31 (+10 %), and the head holds naming a tow fall by
two-thirds. Tows wait at their stands instead (`tow wayOff` refusals). Their time standing on the ground falls from
375 to 222 min.

The go-arounds rise 18 → 21 but are no longer caused by tows: main's five peaks had 2 at commitment behind a tow,
`rs` none. All 21 are behind the arrival ahead (`commit:wait:arrival-*`, `commit:claim:arrival-*`) in the denser
landing stream: 6.0 % of landings on main, 6.3 % on `rs`. This is the trade-off the owner accepted for TASK-363,
now against the not-higher gate.

**`T380=p` on top.** The branch was merged with `task/380-stand-pairing` (`e6efd8ef`) in a scratch worktree
(since removed), keeping the additive conflicts from both sides. The merged diff is
`D:\cityflows-wt\330-pilot\R\t382\combo-merge.patch`. The result is 718 / 24: the
pairing still ends the stepped-out time but adds no completed on top of `rs`.

**Gate 3 (full days) not run.** The ladder stopped at gate 2. An owner decision on the go-around gate for `rs`
would open it.

**Gates 4 and 5** (switch off). The airside matches main (above). The city simulation is untouched, so the Munich
and Freiburg hash pins hold.

| Command | Final lines |
| --- | --- |
| `npm run check` | 308 files passed, 1 skipped; 2,215 tests passed, 2 skipped; built in 1.74 s |
| `npm run test:city` | 77 files passed; 292 tests passed, 1 skipped (1,391.03 s); Freiburg's hash pin holds |
| `npm run test:traffic:light` | 2 files passed; 5 tests passed, 1 expected fail (235.68 s); Munich's pins hold |
| `npm run test:e2e:light` | 63 passed (4.5 min), port 5395 |

Test: `tests/sim/aircraft-tow-way-off.test.ts`, on the fixture with `T382=s`:
- a B777 tow waits at its stand (`tow wayOff`) while a B777 is to leave the runway across its way, and is towed after
  that arrival parks;
- an arrival that waits for the tow does not hold it.

Raw runs are in `D:\cityflows-wt\330-pilot\R\t382\`:
- `dg-*`: main with the counter;
- `r-*`, `rs-*` (`rs2-*` re-run with the ring fix): the rules;
- `rsp-*`: `rs` with `T380=p`.

## Gate 3 (owner follow-up, 2026-11-27)

These days run on `task/382-a380-tows` after merging main `4bf89c3e`, which has TASK-377's exit margin on by default
(merge `1da5c407`). With `T382` unset, peak seed 1 `--checks` matches TASK-383's main `m-p1` (145).

Main references are TASK-383's `R\t383\m-*-d*.json`, main `e6ffa10d` with T377 on. Branch runs use `T382=rs`, in
`D:\cityflows-wt\330-pilot\R\t382\days\`. Cells: completed (landed/departed, go-arounds, overlaps,
`runwayConflictsReal`, gridlock h, mean delay s, tail stops).

| Day | Main | `rs` |
| --- | --- | --- |
| Heathrow 1 | 871 (439/434, 21, 0, 0, -, 14,163, 0) | 887 (451/437, 20, 0, 0, -, 13,394, 0) |
| Heathrow 2 | 869 (442/427, 22, 0, 0, -, 12,050, 0) | 875 (444/433, 25, 0, 1, -, 11,164, 0) |
| Heathrow 3 | 827 (418/409, 28, 0, 0, -, 12,818, 1) | 861 (435/430, 23, 0, 0, -, 11,920, 1) |
| Zurich 730, 1 / 2 / 3 | 729 / 727 / 746 (go-arounds 7 / 7 / 8) | identical |
| Boston 1 / 2 / 3 | 992 / 968 / 996 (go-arounds 17 / 35 / 49) | identical |
| London City 1 | 150 (75/75, 0) | identical |

| Sums | Main | `rs` |
| --- | --- | --- |
| Heathrow, 3 days | 2,567 completed, 1,299 landed, 1,270 departed, 71 go-arounds | 2,623, 1,330, 1,300, 68 |
| Zurich, 3 days | 2,202, go-arounds 22 | 2,202, 22 |
| Boston, 3 days | 2,956, go-arounds 101 | 2,956, 101 |
| London City | 150, 0 | 150, 0 |

On the Heathrow days `rs` raises completed by 56 and landings by 31. Go-arounds fall 71 → 68 and diversions fall
342 → 336. Mean delay falls on every day. The other airports are identical: their tows never meet an arrival's way
off.

**Go-arounds.** The change is in their causes:
- Go-arounds at commitment behind a tow fall from 13 to 3.
- Those behind the arrival ahead rise from 27 to 35, with the extra landings.
- Those behind departures are about level, 31 → 30.

On the peaks the arrival-side rise outweighed the tow-side fall: 18 → 21. Over whole days the tow-side fall is
larger.

**Real runway conflict.** Heathrow day 2 has one real runway-conflict sample, against none on main. At 18:57:47 two
departures, G-KFAD and G-FDXM, are lined up on 27R together; the checker does not exempt that line-up. It is a
departure-side TASK-360 line-up, not a tow, like the triple line-up TASK-363 met on a day 3. Overlaps are 0 and
there is no gridlock on every day.

Read against the day gate (not worse): Heathrow completed and go-arounds are better. Zurich, Boston and London City
are identical. Heathrow day 2's one real runway-conflict sample (0 → 1) is the exception.
