# TASK-369 — Heathrow: an arrival whose way in is blocked by a parked aircraft takes another stand

Status: started 2026-11-27 (owner defaults; airside: merge on gates, realism changes allowed with a cited rule).
Owner: Codex (gpt-6.2-sol, high). Base: main `3602dbd7` (TASK-363 on by default).

## Finding (TASK-353, TASK-358, TASK-363)

With TASK-363 on, an arrival whose way to its stand passes an aircraft parked across it steps out of the landing
order and waits in the air until the way is clear. It no longer holds the arrivals behind it, but it still waits.
Heathrow stepped-out time (bench `steppedOut`):
- peak seed 1: remote stand `st:31169` 1,740 s (the aircraft at `st:31168` stands across its way in);
- full days 1–3: `st:31169` 7,735 / 1,835 / 5,715 s; stand 232 1,840 s and stand 412 490 s on day 2.

`standAvailable` (`src/sim/flight-operations.ts`) checks `standPairSafe` against parked neighbours when a stand is
assigned. TASK-358's way-in pairing rule (parked, `task/358-helipad-clearance` `1ed91f74`) made days worse:
772/726/736 against 752/758/777.

## Goal

An arrival whose way in is blocked by a parked aircraft for longer than a short wait is given another free stand of its
kind, nearest first, as stand planners do (stand reallocation on the day; cite a source such as Heathrow's Stand
Allocation Rules or the ICAO Airport Planning Manual, Doc 9184 Part 1). The reassignment is made while the arrival
is still in the air, or at the latest when it lands. If no stand of its kind is free, it keeps today's behaviour.

Keep TASK-363's step-out and approach order, the TASK-339 parked-blocker rules and the TASK-353 tow rules intact.

## Gates (owner ladder)

1. Heathrow 06:00–08:00 seed 1, `--checks`.
2. Heathrow peaks seeds 1–5 against main:
   - completed not worse in sum;
   - stepped-out seconds down;
   - go-arounds not worse in sum;
   - overlaps 0, `runwayConflictsReal` 0, no gridlock.
3. Full days, seeds 1–3: Heathrow, Zurich (`--daily 730`) and Boston, plus the London City day, against main:
   completed not worse, go-arounds not worse in sum per airport.
4. `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`; re-pin
   `tests/traffic/bundled-airport-load.test.ts` if it changes. City hashes identical.

Main references (on `3602dbd7`) must be measured first: Heathrow peaks 1–5 and days 1–3. TASK-363's runs with the same
code are `D:\cityflows-wt\330-pilot\R\t363\m-p1..p5` and `m-d1..3`; Zurich, Boston and London City are unchanged from
`t360\irm-zrh-d1..3`, `irm-bos-d1..2`, `t353\fo-bos-d3` and `irm-lcy-d1`.

## Result

The allocation check compares parked bodies and pushback sweeps. It does not promise a free
taxi-in path. The A380 G-OOQV was assigned to the code F remote stand `st:31169` in peak seed 1,
but the 777-300ER G-ALJC parked at code E stand `st:31168` stood across its way in. TASK-363 kept
G-OOQV out of the landing order while it waited without moving the arrival to another stand.

| Heathrow main | Stand that could not be reached | Stepped-out time (s) |
| --- | --- | ---: |
| Peak seed 1 | `st:31169` behind `st:31168` | 1,740 of 1,760 |
| Full days seeds 1 / 2 / 3 | `st:31169` | 7,735 / 1,835 / 5,715 |
| Full day seed 2 | 232 / 412 | 1,840 / 1,180 |

The 1,180 s for 412 is the whole-day bench total. All eight fresh Heathrow main runs matched the
TASK-363 JSON apart from runtime. The simulation, bench and fixtures at task start `41666d39`
were unchanged from `3602dbd7`.

**Rule.** Once the TASK-363 taxi-in block persists past a short wait, the arrival can switch to
the nearest free compatible stand of the **currently assigned stand's kind**. The fleet keeps
the runway and approach sequence rank, and changes the reservation only if an arrival route can
be ordered without a parked blocker. With no such alternative, the original stand stays booked
and the aircraft stays stepped out as before. The flight board and any approaching tug are
notified of the change. The parked-blocker and tow decisions are unchanged.
[Heathrow's Allocation of Aircraft Parking Stands, ASGrOps_OSI_047 v3.0 §3.2.6](https://www.heathrow.com/content/dam/heathrow/web/common/documents/company/team-heathrow/airside/operational-safety-insttructions/ASGrOps_OSI_047_Allocation_of_Aircraft_Parking_Stands_v3.pdf)
allows for last-minute stand changes while holding. The wait and nearest same-kind selection are
simulation choices, not Heathrow requirements.

**Checked 06:00–08:00 peak, seed 1 (gate 1).** Both runs reassigned G-OOQV to stand 594 without
overlap, real runway conflict, or gridlock, so the checked-run rung passed. V1 changed the stand
after 120 s at 06:28:09. V2 gave nearby stands more time to become free and changed it after 300 s
at 06:31:09, but picked the same stand. In both cases G-OOQV's touchdown delay fell from 4,840
to 2,095 s, and taxi-in from 677 to 243 s. The original pair fell to 125 / 305 stepped-out
seconds, but stand 412 gained a 1,200 s wait behind helipad `hl:34862` in both runs.

**Five-seed peaks (gate 2).** Main → candidate. Every peak in all three sets had zero overlaps,
zero real runway conflicts and no gridlock. No candidate reassignments occurred outside seed 1.

| V1, 120 s wait | Completed | Go-arounds | Stepped out (s) |
| --- | ---: | ---: | ---: |
| 1 | 145 → 137 | 4 → 4 | 1,760 → 1,340 |
| 2 | 130 → 130 | 2 → 2 | 0 → 0 |
| 3 | 133 → 133 | 0 → 0 | 0 → 0 |
| 4 | 135 → 135 | 4 → 4 | 15 → 15 |
| 5 | 146 → 146 | 8 → 8 | 15 → 15 |
| **Total — fail** | **689 → 681** | **18 → 18** | **1,790 → 1,370** |

| V2, 300 s wait | Completed | Go-arounds | Stepped out (s) |
| --- | ---: | ---: | ---: |
| 1 | 145 → 137 | 4 → 4 | 1,760 → 1,520 |
| 2 | 130 → 130 | 2 → 2 | 0 → 0 |
| 3 | 133 → 133 | 0 → 0 | 0 → 0 |
| 4 | 135 → 135 | 4 → 4 | 15 → 15 |
| 5 | 146 → 146 | 8 → 8 | 15 → 15 |
| **Total — fail** | **689 → 681** | **18 → 18** | **1,790 → 1,550** |

**Full days (gate 3) not run on either candidate.** The ladder stopped at gate 2. These are the
main references, in seed order.

| Airport | Main completed | Main go-arounds | Candidate |
| --- | ---: | ---: | --- |
| Heathrow | 871 / 869 / 827 | 21 / 22 / 28 | Not run |
| Zurich, 730 daily | 729 / 727 / 746 | 7 / 7 / 8 | Not run |
| Boston | 992 / 968 / 996 | 17 / 35 / 49 | Not run |
| London City | 150 | 0 | Not run |

**Repository verification (gate 4 checks run separately).** All five commands exited 0.

| Command | Final result |
| --- | --- |
| `npm run check` | 307 files passed, 1 skipped, 2,205 tests passed, 2 skipped. Built in 1.61 s. |
| `npm run test:city` | 77 files passed, 291 tests passed, 1 skipped (1,777.74 s). |
| `npm run test:traffic:light` | 2 files passed, 5 tests passed, 1 expected failure (290.50 s). |
| `npm run test:e2e:light` | 63 passed (4.2 min) on port 5392. |
| `npm run test:traffic -- tests/traffic/bundled-airport-load.test.ts` | 4 passed (65.58 s), no re-pin. |

The 12 city archives are unchanged from main. Main and the branch also matched the initial
and six-minute simulation hashes for Town (699103425 / 778896873) and Sindelfingen
(692946757 / 1859727685). The only extra airside module touched was `src/sim/ground-vehicles.ts`,
for retiring the arriving tug's visit to the superseded stand.

**Verdict.** Keep the measured five-minute candidate on the task branch for review only. It
shortens the direct hold, but neither wait preserved throughput. It does not meet the merge
gate. Raw runs and the V1 patch are in `D:\cityflows-wt\330-pilot\R\t369\`.
