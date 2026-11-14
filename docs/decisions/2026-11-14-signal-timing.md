# Decision: fixed-time or actuated signals by default

Raised by the lead, 2026-11-14, from TASK-170 and TASK-180 (plan.md review entries).

## Context

TASK-170 gave signal programs an `actuated` flag (a green ends early when its approaches are empty)
and made generated programs actuated. TASK-180 switched generated programs back to fixed-time
(`GENERATED_TIMING = {}` in `src/network/signal-program.ts`) after the zip change. Programs saved with
the flag keep it; either way it is a per-program switch in the signal editor.

## Measurements (after TASK-180's zip)

| | Fixed-time (main) | Actuated |
|---|---|---|
| Mean delay, 0.15, choice off | 853 s | 714 s (-16%) |
| Mean delay, 0.15, choice on | about 118 s | about 81 s (-31%) |
| TASK-154 drain criterion | passes on seeds 1 to 6 | fails on seed 6 (a 1,042 s visit to r:961 against 900 s) |
| Full demand completed | 3,015 | 2,875 |

The seed-6 holdup is the Landsberger loop's exit onto trunk r:307 at n:306, not a signal.

## Options

1. **Fixed-time default** (main). Every gate passes; more delay at 0.15.
2. **Actuated default now**, accepting the seed-6 drain failure (would need the criterion relaxed).
3. **Actuated default after TASK-188** fixes the loop exit and re-measures; switch only if every gate
   passes and full demand completes at least as many trips.

## Lead recommendation

Option 3 (keep option 1 until TASK-188 lands and measures). Actuation is a real delay gain and is how
most German urban signals run, but the drain criterion is a gate.

## How to apply

Option 1: nothing. Option 2: set `actuated: true` in `GENERATED_TIMING`, re-pin city and compile
hashes, and change the TASK-154 drain test (a gate change the owner must approve). Option 3: approve
TASK-188 (`docs/tasks/TASK-188.md`).

Status: awaiting owner
