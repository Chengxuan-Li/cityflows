# TASK-209 — The parked branches: revive or drop

Status: done 2026-11-19. Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/209-parked-review`, worktree `D:\cityflows-wt\209`. Read-only on code.

## Goal

Four pieces of work have been held for a week while main moved a long way (Freiburg, actuated
signals, TASK-193/194/199/202/204 traffic changes):

- TASK-128, stations as trip ends, reviewed and held at `c9a0632`;
- TASK-129, car ownership, reviewed and held at `496cfe6`;
- TASK-130, the Landsberger loop (B56), held at `215afac`;
- TASK-131 Phase 3 (B56 inside junction groups), held at `745d773` (worktree
  `D:\cityflows-wt\131p3`).

For each: read its contract (`docs/tasks/`), its review and the owner's decisions in `docs/plan.md`,
and its branch. Then say whether the problem it solves still exists on main today (measure it: for
B56, whether the Landsberger loop still forms on Munich seeds after TASK-193/204; for TASK-128/129,
whether main already does any of it, e.g. TASK-129's car ownership against main's T67), how far the
branch is from main (conflicting files, rough size of a rebase), what reviving it would change in
traffic results, and a recommendation: revive (with a short contract outline), redo from scratch, or
drop. Do not rebase, merge or modify any held branch or its worktree.

## Scope

A decision document `docs/decisions/2026-11-19-parked-branches.md` (this task asks for it), scratch
measurements outside the repo, no source changes.

## Gates

- Each recommendation backed by a measurement or a diff, not by reading alone.
- `npm run check` passes on the branch (only the document is added).

## Report

The decision document, and a short commit body with the four recommendations.
