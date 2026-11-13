# TASK-170 — Demand-aware and actuated signal timing

Owner: Claude Code subagent (Opus 5.5, high). Branch `task/170-signal-timing`, worktree
`D:\cityflows-wt\170`, ports 5370 / 5470. It starts after TASK-113 is on main. Run it in sequence
with TASK-169, since both touch intersection behaviour.

## Goal

1. **Demand-weighted splits.** Signal programs for single nodes and junction groups split green
   time by expected approach demand, instead of evenly (TASK-161 left even splits). Demand comes
   from the scenario's trips routed on free-flow costs at load. The result is a view of the
   compiled programs passed to the engine, so it is deterministic and per scenario. Keep minimum
   greens and TASK-161's conflict separation.
2. **Optional actuation.** A per-program flag, on by default if it measures better: a phase ends
   early, after its minimum green, when no vehicle is waiting or arriving on its green lanes, and
   skips to the next phase with demand. Walk greens keep their minimums.
3. **The editor** shows the computed split and lets a user override it.

## Scope

`src/network/signal-program.ts` and the generation path, `src/sim/signals.ts` for actuation, the
signal editor in `src/ui`, and tests.

## Gates

- Munich seeds 1 to 3: completed, mean delay and the drain criterion against main.
- The gate unchanged.
- The signal editor e2e spec, T26, T66, T68, T75.
- `npm run check`, `test:city`, `test:e2e:light`.
- Step-time impact.

## Report

Write it as the commit body: the method, numbers, hashes, and anything left open.
