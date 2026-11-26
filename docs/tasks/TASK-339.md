# TASK-339 — No waiting behind aircraft parked across the way

Status: proposed 2026-11-24 (owner: "Write a TASK contract"). Proposed owner: Claude subagent (Opus 5.5), because the
fix needs steering against several gates; Codex CLI (gpt-6.2-sol, high) is the alternative.
Branch `task/339-parked-blockers`, worktree `D:\cityflows-wt\339`, ports 5539 / 5639. Base: `task/330-8h-pilot`
at `07e5e3a6`, the TASK-330 pilot. It is not main: the problem is worst on top of the pilot's progressive ordering, and
the result lands with TASK-330.

## Finding (TASK-330 eight-hour run, 2026-11-24)

The pilot stack is measured with `T330P=300 T330R=1 T330D=1 T330IND=1`, plus `T330TOW=1` where stated. At Heathrow
it gridlocks in a way the 06:00–08:00 window from seeds 1–3 hid:

- **Heathrow seed 4, 06:00–08:00** completes 49/190 (main: 56). Departure 41 waits at 379 m on its taxi leg. The wait
  is on aircraft 19, a tow that went first and then came to rest with its body across 41's lane. The wait is the
  "parked in the way" kind (`predM` Infinity) in `order()`, so it lasts until 19 leaves. 19 cannot start, because its
  next move starts in 41's lane and 41 stands there. 14 aircraft queue behind them.
- **Heathrow seed 1, full day from 00:00:** with `T330TOW` it freezes at about 10:30 (193 completed, 21 stuck). With
  `T330TOW` + `T330PARK` it freezes at about 08:30 (117 by 10:00). Main reaches 367 with 343 diverted, but never
  freezes. The roots in the 10:00 dump: departure 62 waits on parked 23, departure 20 waits on parked 5, and a ring of
  four aircraft forms behind them.

What makes this happen:

1. With progressive ordering, a moving aircraft orders conflicts only within 300 m. An aircraft that parks or comes to
   rest across its route is first ordered as a moving one ("it goes first"). Once it stops, the order becomes "wait
   until it leaves". By then the waiting aircraft is at the conflict, with no turn left before it.
2. `parkedInTheWay` (the route cost that steers around parked bodies) drops parked aircraft that have no stand
   (`other.stand < 0`). A tow resting at a node is invisible to everyone else's route planning.
3. `tryStart` does not refuse a start whose route will wait on a parked aircraft with nothing planned, when that wait
   lies beyond the first leg.

## What the pilot tried (all on `task/330-8h-pilot`; read them, do not copy them blindly)

| Switch | Idea | Result |
|---|---|---|
| `T330BLK` | Re-route a stopped departure around the parked aircraft | Never succeeds: no turn is left before the blocker |
| `T330BLK2` | Refuse a start whose admission waits on a parked aircraft | No effect on seed 4; seed 5 drops 142 → 120 |
| `T330EDGE` | Wait where it stands, within the sampling margin, if its body clears | Never fires: the bodies really touch |
| `T330PARK` | One that would park (stand lead-in or tow rest leg) in the other's way goes second | With TOW, seed 4 49 → 132 and seeds 1–5 total 574 → 630; but Boston go-arounds 5 → 11, and the full day still freezes at 08:30 |

`T330PARK` is the right direction but incomplete. It checks only the conflict at the end of the parker's leg (within
2 × `SAMPLE_M`), and it changes arrival ordering at Boston enough to cost go-arounds.

## Goal

No aircraft waits on an aircraft parked or resting across its route that has no movement planned. Concretely:

1. **Route cost:** route planning treats every parked or resting body as in the way, including those with no stand.
2. **Ordering:** an aircraft whose movement ends (stand, rest point) with its body in another's remaining route goes
   second where it can still stop short. Otherwise the other is re-planned before it reaches the conflict. Decide
   this when the pair is first ordered, not when the parker stops.
3. **Start:** a departure or tow whose route would wait on a parked aircraft with nothing planned does not push back;
   it plans again on a later try.
4. **Recovery:** if such a wait still arises, the waiting aircraft re-plans while a turn is still ahead. If none is
   left, the parked one, when it next asks to move, may plan a route that does not need the waiting aircraft to give
   way.

Landing ordering (`trySpawnArrival`, landing commitment) must not change. Boston's go-arounds rose when `T330PARK`
changed it.

## Scope

- `src/sim/aircraft.ts`: `order()`, `parkedInTheWay` / `noteParked`, `tryStart`, `reroute()` (it may gain an "avoid"
  mode), the progressive ordering (`extendOrder`).
- `bench/airside-delay.ts`: one counter, `parkedBlockS`: the seconds aircraft spend in a wait on a parked aircraft with
  no admission. Report it beside `overlapCount`.
- Tests in `tests/sim/`.

Pilot switches stay as they are. The new rules are unconditional on this branch. With every `T330*` switch off,
behaviour must not get worse (see the gates).

## Out of scope

- Zurich seed 2's ring of three aircraft under `T330R` (each nose at the next one's conflict edge).
- The hold-point overlaps with `T330TOW` + R + D at Heathrow seeds 2 and 3: a widebody's body at a hold reaches into the
  next lane.
- Runway rules, landing release, wake spacing, the checker exemptions.
- `src/schema`, `docs/architecture.md`.

## Gates

All `bench/airside-delay.ts --checks`, branch against base `07e5e3a6`, with the pilot stack switches as above.

- **Heathrow 06:00–08:00, seeds 1–5, stack + `T330TOW`:**
  - total completed ≥ 630;
  - seed 4 ≥ 120;
  - no seed more than 10 below the stack without TOW (150 / 110 / 123 / 49 / 142);
  - overlaps not above base;
  - `runwayConflictsReal` 0;
  - `parkedBlockS` under 300 s per seed.
- **Heathrow seed 1, full day, stack + `T330TOW`:**
  - completions rise in every hour from 06:00 to 23:00, with no freeze;
  - no gridlock (`gridlockH` null);
  - report completed, diverted and delay against main's 367 / 343.
- **Boston seed 1, 06:00–10:00:** completed ≥ 222 and go-arounds ≤ 6 (S5: 223 / 5).
- **Zurich at 730, seeds 1 and 3, 06:00–10:00:** not worse than base (183 / 204). For seed 2, report only.
- **London City seed 1, full day:** 150 / 150.
- **All switches off** (`T330P` unset): Heathrow seed 1 06:00–08:00 and Zurich seed 1 not worse than base.
- Airports batch merge rule: existing cities byte-identical.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body, with a table of every gate and the `parkedBlockS` values. Commit on
`task/339-parked-blockers`. Do not merge.
