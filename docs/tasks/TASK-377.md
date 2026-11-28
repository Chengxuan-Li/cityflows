# TASK-377 — Heathrow: a landed aircraft stops with its tail on the runway

Status: merged 2026-11-27 (lead): the narrower rule is on by default (`T377=0` turns it off). Tail stops on the runway 3 to 1 across the ladder; every other count identical to main. Heathrow day 3's 26 s stop remains (TASK-383). Owner: Codex (gpt-6.2-sol, high). Base: main `138bf349`.

## Finding (TASK-366)

On main (TASK-363 on), Heathrow peak seed 5 has one landed A20N standing 12 s with its tail on the runway. It is held
by a claim 26 m short of vacating, behind a chain of arrivals standing on the exit. A runway must be vacated without
stopping (ICAO Doc 4444 7.10, ICAO Doc 9643 / Doc 9870 runway incursion prevention; CAP 493). TASK-366 (parked
`e78c618b`) added a behaviour-neutral counter `arrivalCauses.tailOnRunway` (seconds and aircraft); port it to main.

## Goal

1. Port the counter; measure it on Heathrow peaks 1–5 and days 1–3, Zurich, Boston and London City days on main.
2. Fix by rule so that no landed aircraft stops with its tail before the vacating point: for example, a lander
   takes an exit only if the space beyond the runway holding position can take its whole body, otherwise the next
   free exit; or the vehicles on the exit chain move up before the lander commits. TASK-366's far-exit swaps made it
   85 s and added runway crossings; keep its `s` guard (no added runway crossing).
3. The counter is 0 on every gate run.

## Scope

`src/sim/aircraft.ts`, `bench/airside-delay.ts` (counter), tests.

Out of scope: the city simulation, `src/network/**` geometry, gate floors, OSM edits, per-id curation.
## Gates (owner ladder; airside merges on gates)

1. Heathrow 06:00–08:00 seed 1, `--checks`.
2. Heathrow peaks seeds 1–5 against main (`D:\cityflows-wt\330-pilot\R\t363\m-p1..p5`: 145/130/133/135/146 = 689,
   go-arounds 4/2/0/4/8): completed not lower in sum, go-arounds not higher in sum, zero overlaps, zero real runway
   conflicts, no gridlock.
3. Full days: Heathrow seeds 1–3 (`R\t363\m-d1..d3`: 871/869/827), Zurich `--daily 730` seeds 1–3
   (`R\t360\irm-zrh-d1..d3`: 729/727/746), Boston seeds 1–3 (re-run main: TASK-370 changed Boston), London City day
   seed 1 (`R\t360\irm-lcy-d1`: 150). Not worse.
4. Cities byte-identical: Munich and Freiburg state hashes.
5. `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

Realism changes need a cited rule (ICAO, CAP, Heathrow operating instructions or similar). Behind a switch while
measuring; on by default only if every gate passes.

## Result (2026-11-27)

**Verdict: not passed.** The standing-leader rule stays off by default (`T377=1` enables it). It passed the
peak ladder but Heathrow full-day seed 3 still records a tail stop. No further variant or ladder rung was run.

Measured from main `8aa8063e`. The TASK-366 counter totals time at or below 0.3 m/s on a landing exit before the
tail passes the vacating point, and counts distinct aircraft. Switching the rule off preserves all common fields
of the historical main peak reports except wall time. Fresh main reproduced 12.4 s on one A20N at roughly 07:08
in Heathrow peak seed 5. The other four main peaks recorded none.

**Rule.** ICAO Doc 4444 (PANS-ATM), §7.10, governs vacating after landing. In the trace the A20N's commitment held
room for its nose beyond the hold line, but the ordinary taxi stop subtracted the forward spacing margin from
that claim. The stopped leader's rear claim prevented an extension even though the bodies had room. If a stopped
leader that the existing landing order allows the arrival to follow has a claim in the stopping envelope, reserve
through the taxi stopping margin at commitment. The ordered wait still limits the claim, and the normal conflict
checks must still pass. The rule does not switch exits or add runway crossings.

**Peak ladder** (`--checks`, Heathrow 06:00–08:00). Cells show completed movements / go-arounds / tail-stop
seconds (aircraft). All runs had zero overlaps, zero real runway conflicts and no gridlock.

| Seed | Main | Full margin on every commitment | Only behind a stopped leader (`T377=1`) |
| --- | ---: | ---: | ---: |
| 1 | 145 / 4 / 0 (0) | 143 / 4 / 0 (0) | 145 / 4 / 0 (0) |
| 2 | 130 / 2 / 0 (0) | 130 / 2 / 0 (0) | 130 / 2 / 0 (0) |
| 3 | 133 / 0 / 0 (0) | 133 / 0 / 0 (0) | 133 / 0 / 0 (0) |
| 4 | 135 / 4 / 0 (0) | 131 / 3 / 0 (0) | 135 / 4 / 0 (0) |
| 5 | 146 / 8 / 12 (1) | 146 / 8 / 0 (0) | 146 / 8 / 0 (0) |
| **Total** | **689 / 18 / 12 (1)** | **683 / 17 / 0 (0)** | **689 / 18 / 0 (0)** |

The broad reservation failed throughput. The narrower rule passed seeds 1–5 and changed no reported behaviour
on seeds 1–4. The focused traffic regression runs the same Heathrow seed 5 schedule to 07:10. It failed on
main's 12.4 s stop and passed with the narrower rule, with at least 20 landings and no sampled body overlaps or
real runway conflicts from 07:00 to 07:10.

**Full-day ladder** (`--checks`; Zurich `--daily 730`). Both values of the tail counter were checked: a
subsecond stop can round to 0 s but still count an aircraft. All completed runs had zero overlaps, zero real
runway conflicts and no gridlock. Cells show completed movements / go-arounds / tail-stop seconds (aircraft).

| Airport and seed | Main | Standing-leader rule |
| --- | ---: | ---: |
| Heathrow 1 | 871 / 21 / 11 (1) | 871 / 21 / 0 (0) |
| Heathrow 2 | 869 / 22 / 0 (0) | 869 / 22 / 0 (0) |
| Heathrow 3 | 827 / 28 / 26 (1) | 827 / 28 / 26 (1) |
| Zurich 1 | 729 / 7 / 0 (0) | 729 / 7 / 0 (0) |
| Zurich 2 | 727 / 7 / 0 (0) | 727 / 7 / 0 (0) |
| Zurich 3 | 746 / 8 / 0 (0) | Stopped before completion |
| Boston 1 | 992 / 17 / 0 (0) | 992 / 17 / 0 (0) |
| Boston 2 | 968 / 35 / 0 (0) | 968 / 35 / 0 (0) |
| Boston 3 | Stopped before completion | Not started |
| London City 1 | 150 / 0 / 0 (0) | 150 / 0 / 0 (0) |

Heathrow totals were unchanged at 2,567 completions and 71 go-arounds. The narrower rule removed the seed-1
day stop but not the seed-3 day stop. The rule only addresses claims from leaders already stopped at commitment.
The cause of the remaining stop was not traced. The outstanding Zurich and Boston runs were stopped when
Heathrow seed 3 failed.

**Cities and tiers.** Munich and Freiburg project archives were not changed. Their state-hash runs and
`npm run check`, `test:city`, `test:traffic:light` and `test:e2e:light` were not run after the day failure.
The focused traffic regression ended with `Test Files 1 passed (1)` and `Tests 1 passed (1)`.
Bench JSON, traces and test logs are in `D:\cityflows-wt\330-pilot\R\t377`.

## Lead completion (2026-11-27)

The lead ran the two day runs Codex stopped before, with `T377=1` against main (`T377=0`):

| Run | Main | Rule on |
| --- | --- | --- |
| Zurich day 3 (`--daily 730`) | 746 / 8 / 0 s | 746 / 8 / 0 s |
| Boston day 3 | 996 / 49 / 0 s | 996 / 49 / 0 s |

Every rung is then identical to main in completed, go-arounds, overlaps and real runway conflicts, with tail stops
3 to 1 (Heathrow peak 5 and day 1 cleared; day 3 keeps 26 s). Under the airside gate (airports not worse) the rule is
on by default. Tiers with it on: `npm run check` 2,213 passed, 2 skipped, built; `test:city` 292 passed, 1 skipped;
`test:traffic:light` 5 passed, 1 expected fail; `test:e2e:light` 63 passed (4.0 min, port 5394). Cities do not run
aircraft, so Munich and Freiburg are unchanged (their pins pass).
