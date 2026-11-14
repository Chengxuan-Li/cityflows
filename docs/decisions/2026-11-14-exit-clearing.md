# Decision: how strictly queues keep lot and garage exits clear

Raised by the lead, 2026-11-14, from TASK-169 and TASK-180 (plan.md review entries).

## Context

TASK-169 added keep-clear zones: a queued car stops short of a lot or garage exit ("mouth") until its
whole body fits beyond it, and a lot car joining inside the mouth needs only the minimum gap to cars
standing beside it. Together these let a lot empty into the queue while the through car behind waited,
which cut full-demand completions from 3,579 (a183a0b) to 2,460. TASK-180 made joins take turns ("zip":
a standing car that let one lot car in is not cut in front of again until it has passed).

## Measurements (Munich, full demand unless stated)

| Variant | Completed | Notes |
|---|---|---|
| Before keep clear (a183a0b) | 3,579 | long exit waits at pk:2049 (the reason for TASK-169) |
| TASK-169 as merged | 2,460 | 269 failed; streets behind busy exits starve |
| TASK-169 + TASK-180 zip (main) | 3,015 | 167 failed; pk:2049 exit waits 17 to 41 s (seeds 1 to 3 at 0.15) |
| Zip without the hold-short half | 3,827 | pk:2049's long exit waits return |

At 0.15 (the gate) every variant passes; main gives 5,294 to 5,312 completed on seeds 1 to 6. Garage
departures waiting over 60 s roughly doubled on main against TASK-169 alone (74/52/51 to 149/93/104 on
seeds 1 to 3), though the longest waits are shorter.

## Options

1. **Keep main as is** (hold short and zip). Exits stay clear; full demand 16% under a183a0b.
2. **Drop the hold-short half**, keep the zip and the minimum-gap join. Full demand 3,827 (+7% on
   a183a0b), but queues block exits again and pk:2049's waits come back.
3. **Hold short only at busy exits** (for example lots above a size, or exits with a measured backlog).
   Needs a task to design and measure.

## Lead recommendation

Option 1 for now: it is the realistic behaviour (German traffic law keeps exits clear) and passes every
gate; consider option 3 as a measured task if full-demand throughput matters more than exit waits.

## How to apply

Option 1: nothing. Option 2: a small change to `keepClearStand` in `src/sim/keep-clear.ts` and its
callers in `src/sim/engine.ts`, with seeds 1 to 6 and full-demand tables and the baseline rule.
Option 3: a new task contract.

Status: awaiting owner
