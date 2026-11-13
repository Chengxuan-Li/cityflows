# TASK-173 — Mode choice at each departure

Owner: Claude Code subagent (Opus 5.5, high). Branch `task/173-departure-choice`, worktree
`D:\cityflows-wt\173`, ports 5373 / 5473. It starts after TASK-113 and TASK-164 are on main.

## Problem

TASK-113 chooses each tour's mode once, when the engine loads, because `parking.ts` builds car
chains and starting stock from the car trips at load. As a result "current link costs" means
load-time costs, with no time-of-day effect. Cars of all-walk days also aren't placed as parked
cars.

## Goal

Each home-based tour chooses its mode when its first trip departs, using the link costs and
parking availability of that moment. The rest of the tour follows the choice.
- Household cars stay assigned as TASK-129 does, but car chains and starting stock become
  progressive: a car is parked at home from the start of the day and leaves only if its tour
  chooses to drive.
- The parking claims and forecasts, TASK-125 and TASK-153, work with cars that decide late.
- Determinism holds: the per-tour random stream is unchanged.

## Scope

`src/sim/persons.ts`, `src/sim/parking.ts` (chains, starting stock, claims), `src/demand/**`
(TASK-113's model), and tests.

## Gates

- With mode choice off, results identical to main.
- With it on, the mode-share guard passes, adjusted with justification if shares shift because
  time of day now matters. Report the hourly shares.
- Every all-walk day's car is parked at home.
- Munich gate with the choice off unchanged.
- T54, T59, T63, T67, `npm run check`, `test:city`, `test:e2e:light`.
- Step time.

## Report

Write it as the commit body.
