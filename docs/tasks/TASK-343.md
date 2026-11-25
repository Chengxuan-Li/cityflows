# TASK-343 — Heathrow runway occupancy and crossings behind each lander

Status: started 2026-11-25 in the owner's 6-hour run (A3). Owner: Claude subagent (Opus 5.5, xhigh).
Branch `task/343-runway-occupancy`, worktree `D:\cityflows-wt\343`. Base: `task/340-ring-free-order` at `4b899a51`.
The owner allows runway-model realism changes where a cited real rule supports them.

## Finding (TASK-330 runs, 2026-11-24)

With the pilot stack + `T330TOW`, Heathrow 06:00–08:00:
- 27L lands 16–22 an hour against a demand of 41. Real single-runway Heathrow lands about 40 an hour.
- The median gap between landings is 136–207 s. Wake spacing alone requires a median of 96 s.

**Floor.** A landing books the runway until its tail is past the exit's hold line, predicted at 78–85 s after the
threshold (a 5 s pad on each side). The exit is taken at 13–14 m/s, capped at `taxiStraightMps`, and the aircraft then
slows on the exit taxi profile. The follower must cross its threshold at least 5 s after that. So the floor is about
90 s.

**Losses above the floor**, as head-hold time between releases:
- 51% spacing;
- 21% gap kept for runway crossers (`leavesGap` / `gapForDeparture`: any aircraft waiting 30 s at a hold earns a gap
  of its occupancy + 2 × 20 s);
- 10% waiting on a queued arrival;
- 9% runway booking.

**Tried, none better than the stack** (switches on `task/330-8h-pilot` at `fbf62eb2`):

| Switch | Idea |
|---|---|
| `T330PAD0` | no pad: go-arounds, gridlock |
| `T330GW` 15/0/60 | crossing-gap wait time |
| `T330GB` 10/5 | crossing-gap buffer |
| `T330R2` | arrivals pass queued arrivals |
| `T330RECAT` | RECAT-EU wake: the rate barely moves because of the floor |
| `T330STAND` | crossing-aware stands |
| `T330XROUTE` | route crossers to the threshold end: no route changes |
| `T330R4` / `T330R4U` | no gap for crossers a lander passes: median gap 104 s but go-arounds |

## Goal

Raise 27L landings an hour at Heathrow peak without go-arounds, overlaps or gridlock, by realistic means:

1. **Runway exit.** Rapid exit taxiways are built for turn-off at up to about 50 kt (ICAO Aerodrome Design Manual
   Part 2). Let an aircraft leave the runway on a rapid exit at a realistic speed, and let it count as clear of the
   runway when its tail passes the runway-holding position on that exit (ICAO PANS-ATM: runway vacated). Make the
   booking predict that.
2. **Crossings.** Crossers behind each landing should cross in batches, so arrivals need fewer separate gaps. A
   crossing at a point the lander has already passed needs no gap. A crossing ahead of where landers roll still does.
   Make that safe against the go-arounds R4 caused: a crosser must be clear before the next lander's decision point.
3. Any other realistic lever you find. Cite the rule.

Keep wake spacing as is unless RECAT-EU is needed once the floor drops; then use `recatSpacingNm` from the pilot.
Landing commitment and go-around rules must stay safe.

## Scope

`src/sim/aircraft.ts` (landings, exits, taxi profile on exits, arrival booking, `leavesGap`, crossing grants), aircraft
performance data if exit speeds need a type field (no schema change without asking), tests in `tests/sim/`.

## Out of scope

Two-runway mixed mode, `tests/sim/aircraft-checks.ts`, `src/schema`, `docs/architecture.md`.

## Tests (owner's ladder)

1. **Light:** Heathrow 06:00–08:00, seed 1, stack + `T330TOW`. Base: 142 completed, 22 landings an hour, median gap
   136 s, 3 go-arounds. Target: landings an hour up at least 15%, completed not lower, go-arounds ≤ 3, overlaps 0,
   `runwayConflictsReal` 0. Then confirm on seed 3 (base 120).
2. The lead runs the wider gates in TASK-346.

`npx tsc --noEmit -p .`, `npx eslint`, the aircraft tests. Commit on the branch with a results table; do not merge.
