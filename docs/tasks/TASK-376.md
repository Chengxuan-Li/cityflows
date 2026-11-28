# TASK-376 — Heathrow: stand-access waits behind the helipad and parked aircraft

Status: parked 2026-11-27 (branch `task/376-stand-access` at `b00f03e3`, rules behind `T376`, off): way-in allocation `a` peaks 689 to 678, with helicopter hold `ah` 683; the blocked pair moves to a tow. Follow-up TASK-380. Owner said "yes" (10 h unsupervised run). Owner: Claude subagent (Opus 5.5). Base: main
`138bf349`.

## Finding (TASK-369)

With TASK-363 on, an arrival whose way to its stand is blocked steps out of the landing order and waits in the air.
Heathrow stepped-out time on main days 1–3: `st:31169` 7,735 / 1,835 / 5,715 s (the aircraft at `st:31168` stands
across its way in); stand 232 1,840 s and stand 412 490 s on day 2. TASK-369's stand reassignment (parked, `10fcf248`)
cut the `st:31169` wait but lost peak landings (689 → 681), and stand 412 then waited 1,200 s behind helipad
`hl:34862`.

## Goal

1. Diagnose every stepped-out or stand-access wait over 300 s on Heathrow main days 1–3 and peaks 1–5: the stand, the
   blocker (parked aircraft, helicopter at or near a helipad, tug, ground vehicle), why it blocks (clearance radius,
   way-in route, pairing), and how long. Table it.
2. Fix the largest cause by rule. Options to weigh: the helipad clearance radius or its shape against the stand's way
   in (check the source of the radius); a way-in route that skips the blocked taxilane; a tow of the blocker under
   the TASK-353 tow rules; stand assignment that avoids a pair the blocker makes. TASK-358's pairing rule (parked
   `1ed91f74`) and TASK-369's reassignment both made days worse: read why before choosing.
3. Keep TASK-363's step-out and approach order, the TASK-339 parked-blocker rules and the TASK-353 tow rules intact.

## Scope

`src/sim/aircraft.ts`, `src/sim/flight-operations.ts`, `src/sim/ground-vehicles.ts` if a tow is involved,
`bench/airside-delay.ts` (counters), tests.

Out of scope: `src/network/**` geometry, the city simulation, gate floors, OSM edits, per-id curation.
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

Parked. Both measured rules fail gate 2 on peak seed 1. They stay on the branch behind `T376`, **off by default**.
With the switch off, the fleet is identical to main.

**Counter** (behaviour-neutral): the bench's `stepOuts` lists each stepped-out arrival by the body across its way
in. It gives the blocker and where it stands, the edge of the arrival's way where it would wait, the distance before
the stand, and the time span. With the switch off, all five peaks and days 1 and 2 match TASK-363's
`m-p1..p5`/`m-d1..d2` JSON apart from wall time and the new fields. Day 3's totals and every count also match,
but one departure's taxi differs by 2 s / 0.5 m. TASK-370 changed taxi waits on main after those references
were made; it is the likely source (unconfirmed).

**Diagnosis** (main, every wait over 300 s; peaks 2–5 have none, only 5 s transients):

| Run | Stand (arrival) | Blocker, where | Waits on (before stand) | When | s |
| --- | --- | --- | --- | --- | ---: |
| Peak 1 | st:31169 (A388 G-OOQV) | B77W G-ALJC parked at st:31168 (carried in, departs 06:55) | `ae:33211` (144 m) | 06:26–06:55 | 1,740 |
| Day 1 | st:31169 (A388 G-YOSI) | B77W G-QNGC at TE3 (carried in, departs 06:34) | `ae:33191` (372 m) | 06:14–06:34 | 1,105 |
| Day 1 | st:31169 (A388 G-YOSI) | B77W G-IUKD at st:31168 (turnaround) | `ae:33211` (144 m) | 07:19–07:45 | 1,525 |
| Day 1 | st:31169 (A388 G-JTOU) | B77W G-GYBZ at TE3 (turnaround after a 5.8 h late arrival) | `ae:33191` (372 m) | 12:56–14:21 | 5,100 |
| Day 2 | st:31169 (A388 G-JXNX) | B77W G-FMKU at st:31168 (turnaround) | `ae:33211` (144 m) | 06:26–06:56 | 1,835 |
| Day 2 | 232 (A388 G-KSSG) | B77W G-ICMH at 217 (turnaround after a late arrival) | taxiway K `ae:33929` (485 m) | 10:15–11:40 | 1,835 |
| Day 2 | 412 (B748 G-DSZF) | A139 G-EEGC on helipad `hl:34862` | Link 44 `ae:33689` (456 m) | 16:11–16:19 | 485 |
| Day 2 | 412 (B748 G-DSZF) | EC45 G-ORIA on helipad `hl:34862` | Link 43 `ae:33696` (498 m) | 16:40–16:51 | 685 |
| Day 3 | st:31169 (A388 G-WKTB) | B77W G-PZTC at TE3 (carried in, departs 07:17) | `ae:33191` (372 m) | 05:41–07:18 | 5,715 |

Why the aircraft are blocked:
- **Parked aircraft.** The largest cause is code F remote stand st:31169: 15,280 of the 19,860 s above, all A380s.
  Its way in passes code E remote stands TE3 and st:31168, and stand 232's way in passes 217 the same way.
  A B77W parked there stands with its centre 74 m from the code F taxiway the A380 turns along. The A380's half-span
  (39.9 m) plus the B77W's half-length (37 m) is 76.9 m, so the swept bodies touch.
  - Nothing at allocation sees this. `blocksTaxiway` checks a parked body only against its own type, and
    `standPairSafe` checks parked bodies and pushback sweeps.
  - No other route avoids the blocker: route costs already avoid parked bodies (`PARKED_FACTOR`).
  - The blockers are turnarounds or carried-in aircraft waiting for their departure. None is idle beyond its schedule.
- **Helicopters.** The helipad is 35 m from the centre lines of Link 43 and Link 44, both code F. A widebody
  (half-span 32–34 m) passing it touches a helicopter body: published length and rotor diameter, 13.6–16.7 m.
  - The TASK-358 radius `HELI_CLEAR_M` (20 m height) has no external source. It sets only how low a helicopter
    counts. The clearance is the bodies themselves.
  - For comparison, Annex 14 Vol I Table 3-1's taxiway centre line to object distance for codes E and F is well
    over 35 m.
  - A helicopter that lands while a widebody is on its way orders that aircraft to wait for its whole stay
    (`heliClear`). Routes do not avoid a helicopter on a pad: `noteParked` skips helicopters.

**Rules measured** (switch `T376=<letters>`):
- `a`, stand allocation. An arrival is first offered a stand whose way in (its planned landing route) no parked
  aircraft or helicopter crosses, among those not admitted or requested. Only with none such does it get one that it
  would wait for. Source: ICAO Annex 14 Vol I 3.13.6 (stand clearances from adjacent aircraft). Stand changes on
  the day follow Heathrow ASGrOps_OSI_047 v3.0 §3.2.6, as TASK-369 cited. The preference order is a simulation
  choice.
- `h`, helicopters.
  - A helicopter does not come down onto a pad, or hover-taxi to one, while its body standing there would cross
    the planned route of a fixed-wing aircraft. It holds at its hover point.
  - Routes keep off a helicopter standing on a pad, as off a parked aircraft.
  - Source: ICAO Annex 14 Vol II 3.1 and Table 3-1, the FATO's separation from a taxiway in simultaneous use by
    aeroplanes.
- Neither rule changes TASK-363's step-out and approach order, TASK-339's parked-blocker rules or TASK-353's tow
  rules. The citations are by name and section, not re-read for this task.

**Gate 1, Heathrow 06:00–08:00 seed 1, `--checks`.** Cells: completed (landed/departed, go-arounds, overlaps,
`runwayConflictsReal`, gridlock h, mean delay s).

| Run | Main | Branch |
| --- | --- | --- |
| `a` (`c1-p1`) | 145 (60/90, 4, 0, 0, -, 1,727) | 134 (52/88, 5, 0, 0, -, 1,630) |
| `ah` (`v2-p1`) | 145 (60/90, 4, 0, 0, -, 1,727) | 139 (55/89, 5, 0, 0, -, 1,724) |

Both runs are clean: no overlap, no real runway conflict, no gridlock. G-OOQV goes to stand 594 at 06:26, and its
delay falls from 4,840 to 1,960 s. Stepped-out time falls to 0 from 1,760 s. `a` gains 284 s of
`parkedBlockS`: an A388 tow waits next to the helipad for the A139 that landed in front of it (07:56). `h` removes
that wait.

**Gate 2, peaks seeds 1–5** (main `t363\m-p1..p5`). Seeds 2–5 match main under both rules. Their JSON is
identical, except that `ah` seed 3 differs in one tow start-refusal counter.

| Seed | Main | `a` | `ah` |
| --- | --- | --- | --- |
| 1 | 145 (60/90, 4) | 134 (52/88, 5) | 139 (55/89, 5) |
| 2 | 130 (56/79, 2) | 130 (56/79, 2) | 130 (56/79, 2) |
| 3 | 133 (55/82, 0) | 133 (55/82, 0) | 133 (55/82, 0) |
| 4 | 135 (66/74, 4) | 135 (66/74, 4) | 135 (66/74, 4) |
| 5 | 146 (65/82, 8) | 146 (65/82, 8) | 146 (65/82, 8) |
| **Sum** | **689, go-arounds 18** | **678, 19: fail** | **683, 19: fail** |

Every run had zero overlaps, zero real runway conflicts and no gridlock. Both fail on completed and on go-arounds.

**Why seed 1 loses.** Stand 594 was where main towed A388 G-JVUS (from 307 at 06:31, towed 06:59). With G-OOQV now
on 594, G-JVUS's tow goes to the stand just vacated, st:31169, past TE3. It is towed only at 08:26.
- From about 07:58 the head of the 27L queue, B77W G-XMZO for TE3, is held. First the standing A388 tows are in its
  way off (`exit:tow-still`). Then it would park at TE3 across the tow's way (`parksAcross:tow`).
- Landings 08:00–08:30 fall from 11 to 0 (`a`) or 3 (`ah`).
- The stand pair moved from the arrival to a tow and to the reverse direction: a B77W parking at TE3 while an A380
  is bound for st:31169.

TASK-369 also moved G-OOQV to 594 and lost 8 completions on this seed. The same displacement is the likely
cause there, but it was not traced. TASK-358's pairing covered the reverse direction but not tows, and it predates
TASK-363. A rule that holds must cover all three cases:
- arrivals and tows bound for st:31169 and the like, by `standAvailable`;
- the reverse, so that a code E aircraft is not given TASK-358's neighbour while a larger aircraft is bound past it;
- its fallback when every stand is blocked. A hard pairing turns waits into stand holds and then diversions after
  `standHoldS`, which may be why TASK-358's days fell.

That is the proposed follow-up. It was not measured here: the ladder allows one variant.

**Gate 3 (full days) not run.** The ladder stopped at gate 2. Main references are as in the contract.

**Gates 4 and 5.** With the switch off, the airside matches main (above). The city simulation is untouched, so the
Munich and Freiburg state-hash pins in `test:traffic:light` and `test:city` hold. The tiers are run with the
default (off):

| Command | Final lines |
| --- | --- |
| `npm run check` | 307 files passed, 1 skipped; 2,214 tests passed, 2 skipped; built in 1.59 s |
| `npm run test:city` | 77 files passed; 292 tests passed, 1 skipped (1,628.59 s); Freiburg's hash pin holds |
| `npm run test:traffic:light` | 2 files passed; 5 tests passed, 1 expected fail (226.87 s); Munich's pins hold |
| `npm run test:e2e:light` | 63 passed (2.8 min), port 5395 |
| `tests/traffic/bundled-airport-load.test.ts` | 4 passed (76.94 s), no re-pin |

Files: `src/sim/aircraft.ts`, `src/sim/flight-operations.ts`, `bench/airside-delay.ts`, and
`tests/sim/aircraft-arrival-sequence.test.ts` (a stand whose way in a parked aircraft blocks is refused when a clear
way in is asked). Raw runs are in `D:\cityflows-wt\330-pilot\R\t376\`:
- `dg-*`: main with the counter;
- `c1-*`: `a`;
- `v2-*`: `ah`;
- `dbg*-p1.err`: the seed 1 queue-head probes.
