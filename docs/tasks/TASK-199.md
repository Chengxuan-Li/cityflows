# TASK-199 — Freiburg jams with actuated signals

Status: done 2026-11-18 (merged as is; Freiburg runs actuated). Proposed
owner: Claude Code subagent (Opus 5.5, high). Branch `task/199-freiburg-actuated`, worktree
`D:\cityflows-wt\199`.

## Goal

TASK-194 made generated signal programs actuated. Freiburg, the landing city (TASK-198), fails its own
gate with them: 11 trips gridlocked (Wallstraße r:2112, Kaiser-Joseph-Straße r:1348, Lessingstraße
r:1059), a head stalled on Dreisamstraße (r:904, at uncontrolled n:903 behind the Schwabentor
junctions) from about 09:13, worst visit 2,838 s, 1,448 completed. Fixed-time on the same tree: 1,430
completed, no failures, worst visit 799 s. Setting single junctions back to fixed time moved the jam
(n:68 with jg:13283: 28 gridlocked; jg:13294: 13; n:18 with jg:13270: 4, r:904 still stalled), so
`curateFreiburg` (`bench/freiburg.ts`) deletes `actuated` from every program.

1. Find why actuation locks Freiburg, with evidence: where the first lock forms, which controllers and
   movements, and why fixed-time avoids it (TASK-194's finding, that actuated outer controllers fill a
   core's exits sooner, is the first suspect).
2. Fix the cause in signal control or the generated programs, not by curation of Freiburg alone.
3. Drop the opt-out in `curateFreiburg`, rebuild the project, and pass Freiburg's gate with actuated
   programs; re-pin what moves.

## Scope

`src/sim/signals.ts` and signal control in `src/sim/**`, `src/network/signal-program.ts`,
`bench/freiburg.ts`, `fixtures/projects/freiburg.cityflows.json`, tests.

Out of scope: `src/schema`, gate floors, `bench/traffic-baseline.json`, routing and lane changes.

## Gates

- Freiburg's gate with actuated programs; Munich seeds 1 to 12, choice off and on, both modes, against
  main (completed / gridlocked / stalled / mean delay / worst loop visit; TASK-154's drain); full
  demand both modes.
- Munich gate and mode-share guard; `npm run check`, `test:city`, `test:traffic:light`,
  `test:e2e:light`.

## Report

Write it as the commit body.
