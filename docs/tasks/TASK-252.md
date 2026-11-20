# TASK-252 — Walk lights at crossings no signal phase serves (TASK-249's open item)

Status: in progress (second unsupervised run, owner 2026-11-20). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/252-unserved-walk-light`, worktree `D:\cityflows-wt\252`, ports 5452 / 5552.

## Goal

TASK-249 (TASK-245's v1; reviews in `docs/plan.md`) lets walkers cross, in a gap, at signalised-junction
crossings that no phase's walk list serves (9 in Freiburg, 3 in Sindelfingen). Their walk light still
draws red (2D and 3D, and in the signal preview) while walkers cross. Draw what the crossing is: no walk
light (dark, or no lamp) at a crossing no phase serves, so nothing shows red while people legally cross;
or, if the light is kept, it must not be red while walkers cross. Say which and why. Render only.

## Scope

The walk-light drawing (2D and 3D lights, the signal preview) and the snapshot field that tells them a
crossing's state, tests, close-ups under `docs/findings/2026-11-20-unserved-walk-light/`.

Out of scope: the walkers' crossing rule (`src/sim/walkers.ts`), signal control, the importer, `src/schema`,
gate floors.

## Gates

- A test that fails without the change; the unserved crossings per city listed with what they now draw.
- Close-ups before and after (2D and 3D).
- Render only: identical state hashes (Munich 0.15 seed 1 four configurations, Freiburg's gate,
  Sindelfingen, both full demands).
- Frame budgets on the Freiburg landing spec, main against branch.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the rule, the list, the hashes, the budgets.
