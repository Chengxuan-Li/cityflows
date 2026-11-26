# TASK-342 — Aircraft at holds clear of the next taxi lane

Status: started 2026-11-25 in the owner's 6-hour run (A2). Owner: Claude subagent (Opus 5.5).
Branch `task/342-hold-lane-clearance`, worktree `D:\cityflows-wt\342`. Base: `task/340-ring-free-order` at
`4b899a51`. It lands with the consolidated airside stack (TASK-346).

## Finding

With the pilot stack plus the tow fix (`T330P=300 T330R=1 T330D=1 T330IND=1 T330TOW=1`), Heathrow 06:00–08:00 has
lasting body overlaps at runway holds. Seed 3 had 376 overlap samples; on the TASK-339 base, seed 2 had 281.

- A B748 (aircraft 82) waits at the 27L hold near (−240, 82). A tow or taxiing A20N / B738 passes on the adjacent
  lane and overlaps its wing for several minutes.
- At seed 3, a B77W holding near (806, 397) overlaps an A20N taxiing past.

The passing aircraft is ordered only against the holder's future path. The holder's parked body at the hold is not
ordered at all, and a widebody's span reaches into the next lane. TASK-337's step-back moves the stop for runway
clearance, but not for clearance to other taxi lanes.

Find each overlap pair with `OVDBG=1` on `bench/airside-delay.ts`.

## Goal

No body overlap between an aircraft stopped at a hold, or any wait point, and aircraft passing on another lane. Either:
- order passers against a stopped aircraft's body (treat it like a parked body for the lanes it reaches into); or
- choose a stop point whose body clears adjacent lanes for the widest type that uses them.

Pick the more general rule and keep it deterministic. Landing release, landing commitment and runway rules do not
change.

## Scope

`src/sim/aircraft.ts` (wait points, holds, ordering against stopped bodies); tests in `tests/sim/`.

## Out of scope

`tests/sim/aircraft-checks.ts`, `src/schema`, `docs/architecture.md`, runway rules.

## Tests (owner's ladder)

1. **Light:** Heathrow 06:00–08:00, seed 3, stack + `T330TOW`. Overlaps go from 376 to 0. Completed not below 120 − 5.
   Then seed 1: not below 142 − 5, overlaps 0.
2. The lead runs the wider gates in TASK-346.

`npx tsc --noEmit -p .`, `npx eslint src/sim/aircraft.ts`, the aircraft test files. Commit on the branch; do not merge.
