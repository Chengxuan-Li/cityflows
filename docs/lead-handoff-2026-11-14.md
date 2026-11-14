# Lead handoff, 2026-11-14 (living document)

**Lead status: ACTIVE** (updated 2026-11-14, main at `dc27280`)

When the lead finishes, this line reads `Lead status: FINISHED at <sha>`. A successor takes over when
it reads FINISHED, or when it reads ACTIVE but no commit has landed on `main` for 3 hours while items
below are still open. Do not trust the ticks below: verify each item against the repository and CI
with the checks given.

## Owner's instruction (2026-11-14)

1. Finish the running task (TASK-183): review, merge, CI, fix CI.
2. Write the planned tasks as contracts in `docs/tasks/` (not executed).
3. Write the pending owner decisions as documents in `docs/decisions/` (not decided, not executed).

The successor verifies and finishes items 1 to 3 only. It does not start any planned task or settle any
decision; those wait for the owner.

## Checklist

### 1. TASK-183 (street, station, stop and place labels in 3D)

- [ ] Agent delivered on branch `task/183-labels-3d` (worktree `D:\cityflows-wt\183`, ports 5383/5483).
- [ ] Lead reviewed and merged: `git log main --oneline | grep "task/183-labels-3d"` shows the merge;
      a "TASK-183 (...; merged)" review entry sits before "## Owner decisions log" in `docs/plan.md`;
      its task row reads done.
- [ ] Main CI green on the merge: `gh run list --branch main --workflow CI --limit 3`.
- [ ] Full run green after the merge: `gh run list --workflow Full --limit 3` shows a success on a sha
      at or after the merge.
- [ ] Screenshots forwarded to the owner (evidence in `D:\cityflows-wt\183-evidence\`).
- [ ] Worktree `D:\cityflows-wt\183` removed (junction first).

### 2. Planned-task contracts (status in plan.md: "planned (not started; awaiting owner)")

- [x] `docs/tasks/TASK-185.md`: 2D labels frame cost (T62 2D +4.0 to +5.5% against the 5% gate).
- [x] `docs/tasks/TASK-186.md`: 2D Evening frame cost (+10.6% against Day, limit 10%).
- [x] `docs/tasks/TASK-187.md`: full-demand step time (rail crossings about 300 s, spawn about 230 s).
- [x] `docs/tasks/TASK-188.md`: actuated signals as the default again, after the seed-6 Landsberger
      loop exit (n:306 onto r:307) drains.
- [x] `docs/tasks/TASK-189.md`: phone-width inspector as a bottom sheet.
- [x] `docs/tasks/TASK-190.md`: parking bays under low ramps.
- [x] `docs/tasks/TASK-191.md`: shortcut chords that browsers reserve.
- [ ] (pending TASK-183) `docs/tasks/TASK-192.md` onward, only if TASK-183 leaves open items (listed here when written).
- [x] Each has a row in `docs/plan.md`'s task table.

### 3. Owner decision documents (each ends "Status: awaiting owner")

- [x] `docs/decisions/2026-11-14-exit-clearing.md`: TASK-169/180 exit-clearing trade-off.
- [x] `docs/decisions/2026-11-14-signal-timing.md`: fixed-time against actuated default.
- [x] `docs/decisions/2026-11-14-light-3d-tints.md`: TASK-166 colour-space fix deepens Light 3D tints.
- [x] `docs/decisions/2026-11-14-evening-hue.md`: TASK-163's mauve evening hue.
- [x] `docs/decisions/2026-11-14-appearance-default.md`: System as the default appearance.

## Where things stand

- Main `dc27280`: CI green; Full run green on `72f8e8c` (TASK-180). Done today: TASK-180, 181, 182,
  184 (see their review entries in `docs/plan.md`).
- Lead worktree for merges: `D:\cityflows-wt\lead-main-ref` (make a `task/lead-<id>` branch from main
  there). Leftover worktrees kept on purpose (uncommitted or unmerged work): `128-remeasure`, `131p3`,
  `136`, `147-egress-verified`, `lead-pr1-merge`, and the Codex worktrees under `C:\Users\cl2749\.codex`.

## Notes as items land

(The lead appends dated notes here.)

- 2026-11-14: contracts TASK-185 to 191 and the five decision documents written and pushed; TASK-183
  still running its frame tests.
