# Decision: the parked branches (TASK-128, 129, 130, 131 Phase 3)

Raised by the owner, 2026-11-18 (TASK-209). Read-only review of four branches held since 2026-11-11
or 2026-11-12, measured against main at `986e807`.

## Summary

| Branch (held tip)                          | On main?                                                   | Problem on main today                                                                                                       | Recommendation              |
| ------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| TASK-128 stations as trip ends (`c9a0632`) | yes, merged 2026-11-13 (`36a1eea`)                         | solved: 1,339 riders a day at Donnersbergerbrücke, T65 green                                                                | drop the hold: nothing left |
| TASK-129 car ownership (`496cfe6`)         | yes, merged 2026-11-13 (`eaeda73`)                         | solved: 2,355 households own 5,313 cars, T67 green                                                                          | drop the hold: nothing left |
| TASK-130 Landsberger loop (`215afac`)      | no: 4 commits, 775 behind, 51 conflict hunks               | gone at 0.15: no ring, worst visit 327 s, roads empty at 10:00. Full demand: no ring, but a backlog (worst visit 1,592 s) | drop                        |
| TASK-131 Phase 3 (`745d773`)               | code yes (`5b1d223` via TASK-154); tip is an empty commit | gone, as for TASK-130                                                                                                       | drop: nothing left          |

No branch is worth reviving, so no contract follows. Two of the four premises in the TASK-209
contract are out of date: TASK-128 and TASK-129 were merged on 2026-11-13 (`docs/plan.md`, the
TASK-129 merge and TASK-159/TASK-128 merge entries, and the task table rows 156 and 157). The "held
at" wording in the TASK-209 contract and in the rail backlog table (rows for TASK-128 and TASK-129)
was not updated when they merged.

## How it was measured

- **Ancestry and distance.** `git merge-base --is-ancestor <tip> main`, `git rev-list --count`
  both ways, `git diff --stat` between each tip and main on the files it touched, and for TASK-130
  `git merge-tree --write-tree main 215afac` (a dry merge that writes no ref and touches no
  worktree), counting conflict hunks and lines in each file of the result tree.
- **Traffic.** `npm run seed-report -- --jobs 2 --seeds 1,2,3` on main `986e807`: Munich 0.15 to
  10:00, seeds 1 to 3, mode choice off and on, TASK-154's drain criteria over the six loop roads
  (`r:961`, `r:364`, `r:248`, `r:703`, `r:273`, `r:997`). On main's import these are still
  Landsberger Straße (`r:961`, `r:364`, `r:248`) and its ramps (`r:703`, `r:273`, `r:997`). A
  scratch script around `probeMorning` (seed 1, both modes, and once at full demand) added TASK-130's
  own gate measure (the cars on the loop roads at 10:00 and their longest accumulated wait), route
  requests, and the household and rider censuses. A scratch copy of the seed report at scale 1 ran the same drain observers at full
  demand, seeds 1 and 2, mode choice off. Four other agents shared the machine, so step times are not
  paired timings.
- **Rules.** `tests/demand/T65-station-riders`, `tests/demand/T67-households`,
  `tests/sim/T67-car-ownership` and `tests/sim/T66-box-cycle` on main: 24 of 24 pass.

Evidence (logs, JSON, the dry-merge file list) is in `D:\cityflows-wt\209-evidence\`.

## Munich on main today

Munich 0.15 to 10:00 on `986e807`:

| Seed | Mode choice | Completed | Gridlocked | Stalled heads | Parking failures | Mean delay (s) |
| ---- | ----------- | --------- | ---------- | ------------- | ---------------- | -------------- |
| 1    | off         | 5,312     | 0          | 0             | 0                | 618.9          |
| 1    | on          | 2,573     | 0          | 0             | 0                | 93.2           |
| 2    | off         | 5,310     | 1          | 0             | 0                | 593.9          |
| 2    | on          | 2,528     | 0          | 0             | 0                | 76.0           |
| 3    | off         | 5,312     | 0          | 0             | 0                | 662.6          |
| 3    | on          | 2,546     | 0          | 0             | 0                | 94.7           |

The Landsberger loop's drain criteria. (a) is a dependency ring through a loop road lasting 300 s or
more. (b) is the worst wait added by one visit to a loop road, limit 900 s. (c) is a car standing on
an inner link over `boxWaitS` at 10:00. (d) is a stalled head.

| Seed | Mode choice | (a) rings | (b) worst visit | (c) inner at 10:00 (longest stop) | (d) | `r:961` | `r:364` | `r:248` | `r:703` | `r:273` | `r:997` |
| ---- | ----------- | --------- | --------------- | --------------------------------- | --- | ------- | ------- | ------- | ------- | ------- | ------- |
| 1    | off         | 0         | 327 s           | 0 (177 s)                         | 0   | 327     | 13      | 19      | 3       | 0       | 0       |
| 1    | on          | 0         | 137 s           | 0 (17 s)                          | 0   | 137     | 9       | 18      | 0       | 0       | 0       |
| 2    | off         | 0         | 275 s           | 0 (176 s)                         | 0   | 275     | 12      | 18      | 2       | 0       | 0       |
| 2    | on          | 0         | 73 s            | 0 (15 s)                          | 0   | 73      | 11      | 16      | 0       | 0       | 0       |
| 3    | off         | 0         | 254 s           | 0 (156 s)                         | 0   | 254     | 13      | 18      | 2       | 0       | 0       |
| 3    | on          | 0         | 137 s           | 0 (16 s)                          | 0   | 137     | 13      | 18      | 0       | 0       | 0       |

TASK-130's own gate counted the cars on the six roads at 10:00 and their longest whole-trip wait
(main on 2026-11-11: `r:961` 24 cars, 5,090 s; `r:364` 17 cars, 5,525 s; `r:248` 17 cars, 6,888 s).
On seed 1 today, in both modes, all six roads are empty at 10:00. With mode choice off, 5,312 of
5,312 released trips have completed by then.

At full demand the corridor is saturated, but it is not a loop. The runs used a scratch copy of the
seed report at scale 1, seeds 1 and 2, mode choice off. Completed and gridlocked were 3,345 / 177
(main's recorded reference after TASK-202) and 3,728 / 149.

- **No ring.** Neither seed had a dependency ring through a loop road at any time, so criterion (a)
  is met.
- **Long visits.** The worst single visits were:
  - `r:961`: 1,592 s and 960 s;
  - `r:997`: 1,025 s and 1,010 s;
  - `r:273`: 784 s and 918 s;
  - `r:703`: 522 s and 685 s.
- **Stalled heads and inner links.** Each seed had 2 stalled heads, both on `r:961`. At 10:00, 5 and
  3 cars stood on inner links longer than `boxWaitS`.
- **Seed 1 at 10:00.** 22 / 0 / 0 / 6 / 19 / 22 cars stood on the six roads. Their longest
  whole-trip waits were 8,100 to 8,600 s, most of it carried from upstream.

The queue runs from `r:961` down the `r:703` and `r:273` to `r:997` ramps, while `r:364` and `r:248`
stay nearly free (13 to 178 s). That is a downstream backlog at full demand, not the closed cycle B56
described. Full demand was never in B56's gate, and the full-demand test does not count stalled heads.

## TASK-128: stations as trip ends

- **Problem on main.** Solved on main. `c9a0632` is an ancestor of main. It was merged through
  `task/159-rider-cost` in `36a1eea` (2026-11-13), after TASK-159 showed that the branch's car loss
  (-11%, -16%, -4%) came from the locked loop. The rider files are on main: `rider-profile.ts`
  unchanged, `stations.ts` +15 / -5 since (TASK-179 moved where riders leave the platform), T65 +4.
  Seed-1 census on main: 1,339 riders a day over 720 stops (673 and 666 per platform), 586 rider walks
  by 10:00, a median walk of 522 m, and 210 stops without riders, all outside service hours. TASK-113
  later had riders ride their S-Bahn ("TASK-128's station riders now ride their S-Bahn").
- **Distance.** 0 commits ahead of main and 694 behind. A merge is a no-op. Checking out the branch
  would drop 694 later commits, among them TASK-179's rider fix and TASK-113's rider transit, both
  built on it.
- **Traffic effect of reviving.** None: the riders are already in every main figure above.
- **Recommendation: drop the hold.** Nothing is left to revive. The branch ref and its re-measure
  worktree (`D:\cityflows-wt\128-remeasure`, `task/lead-128-remeasure`, 4 commits of measurement
  merges on an older main) can be retired when the lead chooses.

## TASK-129: car ownership

- **Problem on main.** Solved on main. `496cfe6` is an ancestor of main. It was merged in `eaeda73`
  (2026-11-13) with TASK-154, TASK-153 and PR #1. Main's T67 is this branch's test.
  `src/demand/households.ts` and `tests/demand/T67-households.test.ts` are identical to the branch.
  `parking.ts` and `persons.ts` have grown since (+1,079 and +467 lines from later parking and mode
  work), and `schedule.ts` has +33. Seed-1 census on main:
  - 2,355 households (964 / 827 / 285 / 191 / 88 of sizes 1 to 5) plus 636 gateway households;
  - 5,313 cars, a home stock of 4,677 equal to the old formula's 4,677 (the default `carShare` is
    1);
  - 0 borrowed car days, 0 members without a free car, 0 car waits.

  With mode choice on, 2,739 of the 5,313 cars stay home. The "no free household car" mode TASK-113
  needed exists on main.
- **Distance.** 0 commits ahead and 695 behind. A merge is a no-op.
- **Traffic effect of reviving.** None: car ownership is already in every main figure above. The
  branch's one rejected change, lowering T63's floor to 3,300, was reverted at the merge, and main
  now completes 5,312.
- **Recommendation: drop the hold.** Nothing is left to revive.

## TASK-130: the Landsberger loop (B56)

- **Problem on main.** Gone on main at 0.15, and at full demand there is no ring either. At 0.15
  there is no dependency ring in six runs, the worst single visit to a loop road is 327 s against the
  900 s limit, and no loop road holds a car at 10:00 on seed 1. At full demand there is no ring on
  seeds 1 and 2, but a downstream backlog remains (see "Munich on main today"). B56 was drained by
  TASK-154 (TASK-131 Phase 3 from `4ab4d71`) and TASK-161 (group signal programs) on
  2026-11-13. It stayed drained through TASK-193, 194, 199, 202 and 204. TASK-204 reported the drain
  criterion met on all 48 runs of its seeds 1 to 12; these runs confirm it at `986e807`.
- **Distance.** The branch has 4 commits on `7868a5d` (2026-11-10), 18 files, +1,978 / -110. Main is
  775 commits ahead. Since that base, main changed `engine.ts`, `intersection.ts`, `lane-change.ts`,
  `reroute.ts` and T66 by +1,557 / -125, with 64 commits on `engine.ts` alone. The dry merge
  conflicts in 12 of the 18 files, with 51 hunks:

  | File                                   | Hunks | Conflict lines |
  | -------------------------------------- | ----- | -------------- |
  | `src/sim/engine.ts`                    | 17    | 503            |
  | `src/sim/intersection.ts`              | 2     | 131            |
  | `src/sim/lane-change.ts`               | 3     | 24             |
  | `tests/sim/T66-box-cycle.test.ts`      | 3 (add/add) | 1,368    |
  | `docs/architecture.md`                 | 4     | 132            |
  | `bench/import-probe.ts`                | 11    | 79             |
  | `bench/traffic-quick.ts`               | 2     | 26             |
  | `bench/traffic-baseline.json`          | 1     | 18             |
  | `tests/sim/T58-head-detour.test.ts`    | 3     | 74             |
  | `tests/sim/T22-zone-timing.test.ts`    | 3     | 29             |
  | `tests/sim/T53-pedestrians.test.ts`    | 1     | 22             |
  | `tests/traffic/munich-morning.test.ts` | 1     | 6              |

  A rebase is a rewrite of the engine part, not a conflict resolution. `link-costs.ts`, `params.ts`
  and the schema fields apply cleanly but depend on the conflicting engine hooks.
- **What main already has of it.** Main already has the branch's ideas, in a different form or as
  tried and measured alternatives:
  - **Exit storage at entry.** The branch rechecks exit storage at entry with a bounded box
    forecast that counts cars already crossing toward the exit. Main does this in `blockedExit`
    (`src/sim/intersection.ts`): an exit-tail forecast bounded by `boxWaitS`, and in-flight cars on
    every incoming movement. Junction groups add exit reservations capped at the lane's length.
  - **T66.** The branch's gate fixture, the four-junction ring that locks on its base, is in main's
    T66. It drains within ten minutes without recovery, keeps uncongested arrivals and order, and
    is deterministic; it passes on main.
  - **Head detours that repeat a blocked movement (`215afac`).** Main rejects head diversions back
    to an unresolved earlier blockage (`unresolvedHeads` in `engine.ts`, `bc093c8`, with three T66
    cases). TASK-193 also keeps detours off roads the trip already drove.
  - **Held required changes (`43cb238`).** Phase 3 re-implemented this rule with the owner's
    approval (`48a0222`). It gave 4,133 completed against 4,214 without it, and was reverted
    (`c5cb049`).
  - **The routing proposal (`avoidEntryLane`).** Phase 3 tried its equivalent, a legal
    approach-bypassing fallback (`5bdc4e8`): 3,722 completed and 9 gridlocked on seed 1. It was
    reverted (`4d321ae`).
  - **Not on main:** the per-vehicle head-cost reuse and the unfinished-traversal floor in
    `link-costs.ts`. The first existed to cut route requests: on its base they fell from about
    209,000 to about 115,000. Main's seed-1 run today makes 57,257 route requests (15,719 with mode
    choice on), already half of the branch's best.
- **Traffic effect of reviving.** It cannot be measured without the rewrite above, but at 0.15 it is
  bounded:
  - **Completed trips.** Main completes every released trip on seed 1 (5,312 of 5,312) with 0, 1
    and 0 gridlocked over seeds 1 to 3, so there is nothing left for the branch to gain.
  - **Step time.** The branch's recorded costs are step time +38 to 51% (lead review; its commits
    record +22 to 75% for intermediate models) and T53 at 7.9% walker cost (limit 6%).
  - **Side by side.** On 2026-11-11 the lead merged it onto main of that day: completed changed by
    -10% to +23% per seed, and the loop waits stayed at 4,600 to 6,200 s.
- **Recommendation: drop.** The problem it targets no longer occurs. Its working ideas are on main in
  a cheaper form, and its other rules were re-tried in Phase 3 and lost trips. Reviving it costs a
  rewrite of `engine.ts` and a large step-time risk for no measurable gain.

  Two items are open, and neither is a reason to revive the branch:
  - **The full-demand backlog.** It runs from `r:961` down the ramps to `r:997`: 2 stalled heads and
    worst visits up to 1,592 s, with no ring. TASK-130 never targeted it. If the owner wants it
    worked, it needs a new task that traces it on main first, as TASK-130's Design 1 did for the
    cycle.
  - **Route requests.** If full-demand speed (TASK-211) later wants fewer route requests, the
    head-cost reuse is the one idea to re-derive on main's engine. Seed 1 at full demand makes
    375,906 requests. That would be a new task, measured on its own.

## TASK-131 Phase 3 (B56 inside junction groups)

- **Problem on main.** Gone on main, as for TASK-130 above. Phase 3 landed through TASK-154 from
  `4ab4d71`, which is an ancestor of main.
- **Distance.** `745d773` is one commit ahead of main, on top of `5b1d223`. It records only a
  message: `git diff 5b1d223 745d773` is empty. `5b1d223`, the "future-aware discretionary lane
  changes" trial, is itself on main through `7500430` and TASK-154. Its `futureChanges`
  (`src/sim/lane-change.ts`) is still in use and was extended by TASK-204. The branch is 668
  commits behind. The side branches of the same work (`task/131-origin-courtesy` `7d60fd0`,
  `task/131-shared-lane-discharge` `ae398f3`) are also ancestors of main.
- **Traffic effect of reviving.** None: the code is in every main figure above. The empty commit's
  three-seed numbers (4,474 / 4,782 / 4,627 completed, loop waits 5,872 to 7,058 s) describe a tree
  from 2026-11-12 that main has long passed.
- **Recommendation: drop.** Nothing is left to revive. The worktree `D:\cityflows-wt\131p3` and its
  branch can be retired when the lead chooses.

## Not done

- **No rebase or merge.** No held branch was rebased or merged, and no held branch or worktree was
  touched. The only checkout was this task's own worktree.
- **TASK-130 was not run on today's main.** That needs the rewrite described above. Its traffic
  effect is bounded by main's own figures and by the branch's recorded measurements.
- **Step times were not paired.** Four other agents ran on the machine, so the step times here
  (seed 1, choice off: 74.9 s) are not a paired, idle measurement.
