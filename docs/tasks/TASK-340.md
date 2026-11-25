# TASK-340 — Ring-free ground ordering

Status: proposed 2026-11-25 (owner: "Write ring TASK contract"). Proposed owner: Claude subagent (Opus 5.5).
Branch `task/340-ring-free-order`, worktree `D:\cityflows-wt\340`, ports 5540 / 5640. Base: `task/339-parked-blockers`
at `e7ce9b31` (TASK-339, gated, not merged). It lands with TASK-330 and TASK-339.

## Finding (TASK-339 gates, 2026-11-24)

The pilot stack is measured with `T330P=300 T330R=1 T330D=1 T330IND=1 T330TOW=1`. It still gridlocks in rings of three
started aircraft. Each one waits for the next and stands about one sample (6 m) inside the next one's conflict edge, so
none can give way:

- **Heathrow seed 3, 06:00–08:00:** ring 10 → 47 → 54 → 10 at 07:54. 94/154 completed, against 118 for the base
  without TASK-339 and 123 for the stack without `T330TOW`. It is the only TASK-339 gate that fails: peak seeds 1–5 total
  622, gate 630.
- **Zurich at 730 a day, seed 2, 06:00–10:00:** 106/206 completed, 22 stuck, one deadlock ring; S5 alone completes
  182. The pilot's R-only run dumped the same kind of ring: 76 → 100 → 35 at 08:38.

What was tried on `task/339-parked-blockers` (all reverted):

| Attempt | Heathrow seed 3 | Zurich seed 2 | Why it fails |
|---|---|---|---|
| None (TASK-339 as gated) | 94 | 106, gridlocked | – |
| `T330RING`: in `breakRings`, a stopped aircraft waits where it stands | 123 | 181 | Works only by letting bodies overlap (+16 / +8 overlap samples) |
| Same, only if its body clears the other's whole sweep | 94 | 106 | Never fires: the bodies really touch |
| `RING_S` 0 s or 15 s instead of 60 s | 101 | 106 | The cycle of waits closes only when the aircraft are already in contact |

So a ring cannot be broken safely once it exists. It has to be prevented when its last wait is ordered.

What the code does now (`src/sim/aircraft.ts` on the base):

- Progressive ordering (`T330P=300`, `extendOrder`) orders a pair's conflicts only once one of them is within 300 m.
  It already avoids the direction that closes a ring (`waitsOn`, `late.flipped`). It defers the decision while both can
  still stop (`late.held`), and forces it when only one direction is possible (`late.forced`).
- Waits also come from `order()` at admission, from the "parked in the way" branch, from `giveWay` in `breakRings`, and
  from re-routes (`reroute`, `rerouteParked`). Those paths do not all check for rings.
- `breakRings` tracks one ring at a time (`lastRing`). Its timer restarts whenever the first ring found changes, so
  with two rings neither may reach `RING_S`.

## Goal

No ring of waits between started aircraft forms where none of them can give way without overlap.

1. **Find the source.** Add a debug counter or log that records, for every deadlock ring (`late.deadlocks`), which
   path added the wait that closed it: forced in `extendOrder`, `order()` at admission, parked branch, `giveWay`, or
   re-route. Report it for Heathrow seed 3 and Zurich seed 2 before changing behaviour.
2. **Prevent it there.** Every path that adds a wait checks `waitsOn` first. Where both directions would close a ring,
   or only the closing one is possible, the aircraft that can still stop is held short earlier. That means before the
   last station where it could stop short of the conflict, not after. For example, order the pair while there is still
   room, beyond the 300 m horizon if needed, or hold the later aircraft at its previous wait point or hold.
3. **Track every ring.** `breakRings` keeps a timer per ring key, so two rings do not reset each other.
4. Landing ordering (`trySpawnArrival`, landing commitment) and runway rules do not change.

## Scope

- `src/sim/aircraft.ts`: `order()`, `extendOrder`, `breakRings`, `commitOrder` / `giveWay`, and the re-route waits.
- Tests in `tests/sim/`: a built junction where three aircraft would close a ring; with the fix, none deadlocks and none
  overlaps.

Pilot switches stay. The new rules are unconditional on this branch.

## Out of scope

- The hold-point overlaps from `T330TOW` + R + D (a widebody's body at a hold reaches into the next lane: Heathrow
  seeds 2 and 3).
- Runway rules, landing release, wake spacing, checker exemptions, `tests/sim/aircraft-checks.ts`.
- `src/schema`, `docs/architecture.md`.

## Test phases (owner's light-first rule)

**Phase 1, light:** Heathrow 06:00–08:00 seeds 3 and 1, and Zurich 730 seed 2, 06:00–10:00. One run each per variant.
No full days and no other cases until phase 1 meets its targets:

- Heathrow seed 3 ≥ 115.
- Zurich seed 2 ≥ 175, with no gridlock.
- Heathrow seed 1 ≥ 145.
- Overlaps not above base (seed 3: 376, seed 1: 0, Zurich seed 2: 0).
- `runwayConflictsReal` 0, `parkedBlockS` 0, `late.deadlocks` 0.

**Phase 2, gates** (only after phase 1; the lead may run them):

- Heathrow peak seeds 1–5, stack + `T330TOW`: total ≥ 630, no seed more than 5 below base (146 / 113 / 94 / 134 / 135),
  overlaps not above base.
- Heathrow seed 1 full day: ≥ 774 completed, no freeze.
- Boston seed 1 06:00–10:00: 223, go-arounds ≤ 6.
- Zurich seeds 1 and 3: not worse than 183 / 204.
- London City full day: 150 / 150.
- All switches off: identical to base.
- Airports batch merge rule: existing cities byte-identical (Freiburg 1710089250).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the ring-source table from goal 1, each variant run with its numbers, and the phase 1
targets. Commit on `task/340-ring-free-order`. Do not merge.
