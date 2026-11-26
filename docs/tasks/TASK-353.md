# TASK-353 — Tow-backs at the start of a run are not held

Status: done on `task/353-tow-backs` 2026-11-26, not merged (see Result). Owner: Claude subagent (Opus 5.5).
Base: main `07dc95b4`.

## Finding (TASK-344, 2026-11-25)

At Heathrow seed 1, 06:00–08:00, about 46% of departures' readiness wait (58,800 of 128,700 s) comes from aircraft
already on the ground at the run's start. They are parked overnight at remote stands, and their tow back to the
departure stand is held at the start, for up to 2.4 h for some flights. The rest is late inbound flights.

## Goal

Aircraft parked away at the run's start are towed back in time for their departures, as the overnight plan intends.
- Find why the tow-backs are held at the start (`flight-operations.ts`, the tow request timing and its admission).
- Fix it with a general rule.

The owner accepts that this changes every light-run baseline.

## Gates

- Heathrow 06:00–08:00 seeds 1–5: readiness wait from start-of-run aircraft down, completed up or level, no new
  overlaps or gridlock.
- London City, Zurich and Boston light runs not worse.
- Full days for the three large airports, seeds 1–3, against main.
- Light tiers.

## Result (2026-11-26)

**Root cause.** An overnight aircraft carried in at the run's start is parked at a remote stand and was given
`leftStand = regular[0]`, the first stand of its kinds in index order, a stand it never left. At departure − 20 min
its tow went to that stand or to the first free stand of its kinds in index order. Heathrow has 33 contact and 253
remote stands, so with the contact stands full most tow-backs went remote to remote, often across the airfield. The
tows were requested on time but held at their start (`tow firstLegWait:ground` 78,700 s at seed 1): every departure
that starts later goes before a tow still at its stand (TASK-329).

**Rule** (`serviceStand`). The tow back goes to the stand the aircraft left (none for one parked away at the start),
else to the nearest free stand of the flight's own kind. With none free it departs from the stand it is on when its
flight may use that stand (a contact flight from a remote stand), else it is towed to the nearest free stand its
flight may use. The bench reports `readiness` (carried-in and other departures' summed readiness wait, the carried-in
tows' request-to-towed time) and TASK-344's `startRefusals`.

Heathrow 06:00–08:00, `--checks`, main → branch (carried-in: departures parked at the run's start):

| seed | completed | carried-in readiness s | other readiness s | startWaitS | tows | go-arounds |
|---|---|---|---|---|---|---|
| 1 | 128 → 120 | 70,991 → 21,112 | 81,715 → 103,241 | 1,121 → 1,344 | 37 → 18 | 6 → 8 |
| 2 | 114 → 123 | 79,244 → 37,211 | 61,081 → 46,077 | 815 → 1,323 | 35 → 23 | 0 → 1 |
| 3 | 124 → 121 | 53,982 → 17,262 | 39,219 → 47,961 | 985 → 1,268 | 36 → 21 | 3 → 5 |
| 4 | 125 → 124 | 53,069 → 16,808 | 111,198 → 111,410 | 934 → 1,131 | 42 → 29 | 1 → 5 |
| 5 | 124 → 129 | 57,296 → 42,750 | 84,420 → 79,703 | 1,176 → 1,099 | 27 → 19 | 3 → 2 |

Seeds 1–5: completed 615 → 617, carried-in readiness 314,582 → 135,143 s (−57%); overlaps 0, `runwayConflictsReal` 0, no gridlock on every seed. Part of the readiness
wait moves into start wait: those that no longer wait for a tow wait for their start at the remote stand.

Light runs: London City day 150 → 150; Zurich 730 06:00–10:00 183 → 187 (carried-in readiness 16,310 → 24 s, 25
overlaps on both); Boston 06:00–10:00 223 → 223, identical. Full days, main → branch: Zurich 730 716/727/746 →
729/727/746 (carried-in readiness 23,247/12,727/5,892 → 24/463/29 s); Boston 991/971/996 → 992/968/996
(go-arounds 27/38/27 → 17/35/49, overlaps 22/0/11 on both).

Heathrow full days (`--checks`, 1,306 movements; main 766/668/725) were still running at report time. Completed by
hour, main → branch: seed 1 at 08:00 125 → 94, 13:00 332 → 312, 19:00 572 → 550 (diverted 105 → 111); seed 2 at
13:00 274 → 329, 22:00 599 → 686 (diverted 206 → 155; main's whole day is 668); seed 3 at 13:00 317 → 303. Their
JSON lands as `fo-lhr-d1/2/3.json`.
Seed 1's loss is a stall of one arrival end, not a tow: from 05:30 an arrival queued for remote stand st:31169 waits
for the parked aircraft at TE3 and then for one that parked at st:31168 across its way in (a larger aircraft passing
one parked there waits for it, TASK-312), and as the head of its end's queue it holds every later arrival to that end
for over an hour (queued arrivals 39 → 62 at 07:00). The stand allocation pairs st:31169 with an occupied or reserved
neighbour whose parked body is in its way; main can meet the same pairing on another trajectory. A follow-up: the
stand pairing check (`standPairSafe`) or the release should account for a neighbour's body across the way in.

Tiers: `npm run check` (301 files, 2,166 tests passed), `test:city` (76 files), `test:traffic:light` (5 passed, 1
expected fail), `test:e2e:light` (63 passed). Outputs: `D:\cityflows-wt\330-pilot\R\t353\`.
