# TASK-380 — Heathrow: two-way stand pairing that covers tows, with a fallback

Status: parked 2026-11-27 (branch `task/380-stand-pairing` at `e6efd8ef`, `T380` off): peaks 689 to 687 (`p`, go-arounds 19) and 683 (`pn`, 20); stepped-out waits 1,790 to 0 s. Seed 1 is limited by two A380 tows that block the 27L way off (TASK-353 tow rules). Started by the lead in the 10 h unsupervised run; airside merges on gates. Owner: Claude subagent (Opus 5.5,
continuing TASK-376). Base: branch `task/376-stand-access` at `b00f03e3`.

## Finding (TASK-376)

Stepped-out waits over 300 s on Heathrow main are 77% A380s bound for code F remote stand `st:31169`, blocked by a B77W
parked at TE3 or `st:31168` (A380 half-span plus B77W half-length 76.9 m against 74 m to the taxiway). Stand allocation
checks parked bodies and pushback paths only. TASK-376's way-in allocation (`T376=a`) gave G-OOQV another stand on peak
seed 1, but the conflict moved: a tow of another A380 went to `st:31169` past TE3 instead, and from 07:58 the 27L
arrival queue head (a B77W bound for TE3) was held; landings 08:00–08:30 fell from 11 to 0. Peaks 689 → 678 (`ah` 683).

## Goal

A two-way pairing rule: a stand is not assigned (to an arrival or a tow) if its occupant would stand across the way in
of an aircraft already assigned to, or on its way to, a stand it blocks; nor if a parked aircraft stands across its own
way in. Tows count as arrivals. When every compatible stand is blocked, keep today's behaviour (fallback), so a block
never becomes a diversion or a held runway exit. Cite the rule (ICAO Annex 14 Vol I 3.13.6; Heathrow ASGrOps_OSI_047
§3.2.6). Behind a switch while measuring; one variant allowed after the first.

## Scope

As TASK-376: `src/sim/aircraft.ts`, `src/sim/flight-operations.ts`, `bench/airside-delay.ts`, tests.

## Gates

TASK-376's ladder: Heathrow peak seed 1 `--checks`; peaks 1–5 (689, go-arounds 18) not lower / not higher; full days
Heathrow 1–3, Zurich `--daily 730` 1–3, Boston 1–3 (re-run main), London City day 1 not worse; Munich and Freiburg
hashes identical; `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Result (2026-11-27)

Parked. The first version and its one variant both fail gate 2. They stay on the branch behind `T380`, **off by
default**; with the switch off the branch is TASK-376's `b00f03e3`, identical to main.

**Rule** (`T380=p`, `wayBlocked` in `src/sim/aircraft.ts`; `requestArrival` and `requestTow` take `clearWayIn`).
A stand is refused to an arrival or a tow (a tow counts as an arrival) along its planned way when any of these holds:
1. Its way passes a parked aircraft with no movement admitted or requested, or a helicopter on a pad (TASK-376 `a`).
2. Its way passes the parked body that an aircraft bound for another stand will have there.
3. Its own parked body at the stand would stand across the remaining way of an aircraft bound for another stand. The
   bound aircraft's way is its admitted legs, else its planned landing or tow, found once per request.

Flight operations first try every compatible stand under the pairing (arrivals, and tows in `tow()`), then fall back
to today's choice. A block therefore never becomes a stand hold, a diversion or a held exit.

Sources: ICAO Annex 14 Vol I 3.13.6 (clearance between an aircraft using a stand and adjacent aircraft); Heathrow
ASGrOps_OSI_047 v3.0 §3.2.6 (stand allocation and changes on the day). Both are cited by name and section, not re-read.

**Variant** (`T380=pn`). Checks 2 and 3, between two aircraft bound for stands, look only at the last 500 m
(`WAY_IN_M`) of each way in. This covers every TASK-376 blocker, which stood 144–498 m before the stand. Check 1
stays on the whole way. Peak seed 4 showed why: under `p` the B738 G-MUZG was kept off stand 440, because its parked
body crosses taxiway T 1.5–2.7 km before three A380s' stands. Three stands changed, and the seed lost 8 completed.

**Gate 1, Heathrow 06:00–08:00 seed 1, `--checks`.** Cells: completed (landed/departed, go-arounds, overlaps,
`runwayConflictsReal`, gridlock h, mean delay s).

| Run | Main | Branch |
| --- | --- | --- |
| `p` (`p1-p1`) | 145 (60/90, 4, 0, 0, -, 1,727) | 152 (65/92, 7, 0, 0, -, 1,740) |
| `pn` (`p2-p1`) | 145 (60/90, 4, 0, 0, -, 1,727) | 137 (58/86, 6, 0, 0, -, 1,635) |

Both runs are clean, so the checks pass. Under `p`:
- G-OOQV goes to stand 594 (delay 4,840 → 2,005 s).
- The TE3-bound B77W G-XMZO goes to `st:31168`.
- The A380 G-JVUS's tow goes to 595, not to `st:31169`.
- No arrival steps out (main 1,760 s), but 764 s of ground waits on parked aircraft (`parkedBlockS`) appear.

**Gate 2, peaks seeds 1–5** (main `t363\m-p1..p5`):

| Seed | Main | `p` | `pn` |
| --- | --- | --- | --- |
| 1 | 145 (60/90, 4) | 152 (65/92, 7) | 137 (58/86, 6) |
| 2 | 130 (56/79, 2) | 130 (56/79, 2) | 130 (56/79, 2) |
| 3 | 133 (55/82, 0) | 133 (55/81, 0) | 133 (55/81, 0) |
| 4 | 135 (66/74, 4) | 127 (61/70, 3) | 135 (66/74, 4) |
| 5 | 146 (65/82, 8) | 145 (67/82, 7) | 148 (67/83, 8) |
| **Sum** | **689, go-arounds 18** | **687, 19: fail** | **683, 20: fail** |

Every run had zero overlaps, zero real runway conflicts and no gridlock.

| Sum over the 5 peaks | Main | `p` | `pn` |
| --- | ---: | ---: | ---: |
| Stepped out (s) | 1,790 | 0 | 25 |
| `parkedBlockS` (s) | 0 | 764 | 416 |
| Landings | 302 | 304 | 302 |

The pairing ends the stepped-out waits and does not cost landings. It misses the completed gate by 2 and 6 and the
go-around gate by 1 and 2.

The results move with stand changes several steps removed from the rule. In `pn` seed 1, G-OOQV and G-JVUS's tow go
where they went under `p`, but G-XMZO takes TE3, and landings 08:00–08:30 fall from 11 to 6. In both versions the queue head is
then held by the two A380 tows of G-JVUS and G-TXFW standing in the way off the runway (`exit:tow-still`). Those tows
take 47–98 min from request to towed. That tow and exit interaction is the residual limit on seed 1, outside this
rule (TASK-353's tow rules).

**Gate 3 (full days) not run.** The ladder stopped at gate 2.

**Gates 4 and 5** (switch off):
- Heathrow peak seed 1 matches main's `m-p1` JSON apart from wall time and the counters (`off-p1`).
- The city simulation is untouched, so the Munich and Freiburg hash pins hold.

| Command | Final lines |
| --- | --- |
| `npm run check` | 307 files passed, 1 skipped; 2,215 tests passed, 2 skipped; built in 1.64 s |
| `npm run test:city` | 77 files passed; 292 tests passed, 1 skipped (2,213.60 s); Freiburg's hash pin holds |
| `npm run test:traffic:light` | 2 files passed; 5 tests passed, 1 expected fail (312.90 s); Munich's pins hold |
| `npm run test:e2e:light` | 63 passed (5.5 min), port 5395 |

Test: `tests/sim/aircraft-arrival-sequence.test.ts`. With a B777 bound for J past K, the pairing refuses K to an
E190 arrival and to an E190 tow; without `clearWayIn` the tow is accepted. Raw runs are in
`D:\cityflows-wt\330-pilot\R\t380\`: `p1-*` is `p`, `p2-*` is `pn`.
