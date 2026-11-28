# TASK-383 — Heathrow day 3: the last tail stop on the runway

Status: started 2026-11-27 (lead, 10 h unsupervised run; airside merges on gates). Owner: Codex (gpt-6.2-sol, high).
Base: main `007c2d02` (TASK-377 on).

## Finding (TASK-377)

TASK-377's exit margin (on by default) cleared the tail stops on Heathrow peak seed 5 and day 1. On Heathrow full day
seed 3, one landed aircraft still stands 26 s with its tail before the vacating point (`arrivalCauses.tailOnRunway`).
TASK-377 did not trace it.

## Goal

1. Trace the day-3 stop: who stops, where, what claim holds it, and why the TASK-377 margin does not apply. Example
   causes: the leader is moving rather than standing; the holder is a departure or a crossing aircraft rather than an
   arrival on the same way off; a tug or tow.
2. Extend the rule to cover it (ICAO Doc 4444 §7.10), without adding runway crossings or changing exits. Keep the
   change behind a switch while measuring; one variant allowed.

## Scope

`src/sim/aircraft.ts`, `bench/airside-delay.ts`, tests.

## Gates

TASK-376's ladder:
- Heathrow peak seed 1 `--checks`;
- peaks 1–5 (689, go-arounds 18): completed not lower, go-arounds not higher;
- full days not worse: Heathrow 1–3, Zurich `--daily 730` 1–3, Boston 1–3, London City day 1. Re-run main for every
  day reference, since TASK-377 changed main.
- Tail stops 0 on every run.
- Munich and Freiburg hashes identical;
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Result (2026-11-27)

**Verdict: not passed.** The late use of the arrival's existing claim (`T383=1`) passed the peaks
but increased Heathrow day-3 go-arounds. The one variant, an earlier commitment reservation
(`T383=2`), lost two peak completions. Both modes are off by default. TASK-377 stays on.

**Trace (main `e6ffa10d`, TASK-377 on).** On Heathrow day seed 3, B77W G-EAGX (#195, stand 322)
committed at 11:52:11.9 and took the 27L exit via N5W/N5E toward A. A20N G-ZUSN (#194, stand 546L) was
already on that exit at 8.17 m/s. It passed the existing `leaving` check but was not standing, so
TASK-377 reserved only to station 318.08 m for #195, without the 52 m front margin. After rollout,
#194 stopped on A. At 11:53:54 its rear claim limited #195's forward claim to 361.27 m. Subtracting
the B77W's half-length (36.95 m) and the front margin gave a stopping station of 272.32 m, 3.81 m
short of its tail-clear station (276.13 m). The taxi order cap was 348.81 m and did not cause the
stop. #194 moved again about 25 s later. The counter recorded 26.0 s on one aircraft.

**Late rule (`T383=1`).** Apply the vacating principle of ICAO Doc 4444 (PANS-ATM), §7.10, when the claim would
stop the lander before its tail is clear and it is in braking range of that stop. If the lander
already claims room through its safe stopping point and is following a stopped, ordered arrival
whose rear clearance bounds the claim on the same directed piece, it may use that room. The
leader's full rear margin still separates the aircraft. The follower gets no new claim, and
the existing taxi waits, runway gates, exit and crossings are unchanged.

The rule applied to G-EAGX at 11:53:52.8 with its old 361.27 m claim and 348.81 m taxi cap
unchanged. It could target 281.13 m instead of stopping at 272.32 m. The focused midnight-to-11:55
replay recorded zero tail stops, overlaps, real runway conflicts and gridlock.

**Commitment variant (`T383=2`).** Apply TASK-377's extra reservation at landing commitment if a
shorter, moving predecessor already approved as leaving is still clearing the same exit. Require
the additional interval to be clear of claims from aircraft not already approved as leaving or
yielding. This variant also cleared the focused replay, without changing the exit or granting any
crossing.

**Peak ladder** (Heathrow 06:00–08:00, seeds 1–5, `--checks`). Cells show completions /
go-arounds / tail-stop seconds (aircraft). Every run had zero overlaps, zero real runway conflicts
and no gridlock. Each mode passed the seed-1 safety check before seeds 2–5 ran.

| Seed | Fresh main | Late rule | Commitment variant |
| --- | ---: | ---: | ---: |
| 1 | 145 / 4 / 0 (0) | 145 / 4 / 0 (0) | 143 / 4 / 0 (0) |
| 2 | 130 / 2 / 0 (0) | 130 / 2 / 0 (0) | 130 / 2 / 0 (0) |
| 3 | 133 / 0 / 0 (0) | 133 / 0 / 0 (0) | 133 / 0 / 0 (0) |
| 4 | 135 / 4 / 0 (0) | 135 / 4 / 0 (0) | 135 / 4 / 0 (0) |
| 5 | 146 / 8 / 0 (0) | 146 / 8 / 0 (0) | 146 / 8 / 0 (0) |
| **Total** | **689 / 18 / 0 (0)** | **689 / 18 / 0 (0)** | **687 / 18 / 0 (0)** |

The late rule's peak JSON matched main apart from wall time. The commitment variant failed
the peak throughput gate and did not enter the full-day rung.

**Full days** (`--checks`, Zurich `--daily 730`). Main was re-run with TASK-377 on for every
reference. All completed runs had zero overlaps, zero real runway conflicts and no gridlock.

| Airport and seed | Fresh main | Late rule |
| --- | ---: | ---: |
| Heathrow 1 | 871 / 21 / 0 (0) | Not started after day 3 failed |
| Heathrow 2 | 869 / 22 / 0 (0) | Stopped after day 3 failed |
| Heathrow 3 | 827 / 28 / 26 (1) | 836 / 30 / 0 (0) |
| Zurich 1 | 729 / 7 / 0 (0) | 729 / 7 / 0 (0) |
| Zurich 2 | 727 / 7 / 0 (0) | 727 / 7 / 0 (0) |
| Zurich 3 | 746 / 8 / 0 (0) | 746 / 8 / 0 (0) |
| Boston 1 | 992 / 17 / 0 (0) | 992 / 17 / 0 (0) |
| Boston 2 | 968 / 35 / 0 (0) | 968 / 35 / 0 (0) |
| Boston 3 | 996 / 49 / 0 (0) | Not run |
| London City 1 | 150 / 0 / 0 (0) | Not run |

Heathrow day 3 lost the one late-clear go-around (`lateClear:arrival-still`, 1 → 0), but go-arounds
from waiting for departures already stopped at a runway gate rose from 4 to 8, and those from
waiting for moving arrivals rose from 4 to 6. Other categories offset part of the increase.

**Cities and tiers.** The ladder stopped before the Munich and Freiburg hash comparisons and
before `npm run check`, `test:city`, `test:traffic:light` and `test:e2e:light`. Neither city's
fixtures or simulation changed. The existing focused TASK-377 traffic regression with the
late rule on ended with `Test Files  1 passed (1)` and `Tests  1 passed (1)`.
The parked branch passed standalone typecheck (`tsc -b`, exit 0).
Bench JSON and trace logs are in `D:\cityflows-wt\330-pilot\R\t383`.
