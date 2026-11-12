# Lead handoff, 2026-11-12

From the outgoing lead (Claude Code session, Opus 5.5) to the temporary lead. Main is at
`817f93f` plus this doc's commit, and CI is green. `docs/plan.md` stays the record of truth; this
doc tells you where things stand and how the role runs today. Read `AGENTS.md`, `CLAUDE.md`,
`docs/plan.md` ("Lead handover", "Owner backlog (2026-11-10)", the last ten review entries and the
newest owner decisions) and `docs/architecture.md` before you start anything.

## 1. Your role and its limits

You hold the main thread: you write contracts and plans, cut branches, start and steer agents,
review, merge and push `main`, and keep `docs/plan.md` current.

- **Standing rule (owner, 2026-11-11):** the lead runs the backlog as Claude Code subagents from
  its own session, using Claude models at most Opus 5.5 at high effort. Run work in parallel when
  the file surfaces are disjoint and in sequence when they are not. Don't stop for the owner's
  approval or review. You still review every commit, merge it and report outcomes, with shots for
  visual work.
- **Overriding it right now (owner, 2026-11-12):** "stop when you finish with the ongoing task(s)
  and reviews of 130. after that we discuss job allocation." That point is reached. **Start no new
  agent until the owner has settled job allocation with you.** The owner may hand some tasks to
  Codex and run those agents themself. Codex tasks belong to the owner: review them when they
  report, but don't drive them.
- **Waiting on the owner, don't decide alone:** merging TASK-128, TASK-129 or TASK-130; the
  traffic gate method (section 3); and lowering any gate floor (the TASK-129 agent lowered T63's).
- **Yours to decide:** a contract within the owner's decisions, hash re-pins, a baseline reset at
  a merge that moves trips, small sim fixes at merge (log them), and model and effort choices.
- Never commit to `main` directly. Every change goes through a `task/...` branch, merged with
  `--no-ff`.

## 2. What landed in this session (all on main, CI green)

| Task | What | Notes |
|---|---|---|
| TASK-131 Phases 0-2 | Junction groups. OSM nodes keep their positions. Nodes joined by links up to 30 m (`junctionGroupMaxM`) form `City.junctionGroups` with inner roads, one signal controller and one drawn surface. Inner links have no control but do get lane lines. The collision model is off. B54 is amended, and B55 is done with side-by-side strips. | Phase 3 (the box rule across inner links) is **not done**: 25 of 30 unsignalised Munich groups still let an inner-link car yield. The lead fixed the clamp of `planLane`'s cutoff in `src/sim/engine.ts` at merge. |
| TASK-140 | B59: the stripes' centreline is the one crossing position, for walk links, walk lights and conflict zones. | The traffic baseline was reset here. |
| TASK-135 | Trams are their own track type, with `form` (embedded, grass, paved, ballast). | |
| TASK-133 | Station furniture. | The timetable hash now covers values rounded to 0.01 s, a Node vs Chromium float issue. |
| TASK-132 | Rail heights from tags: tunnels at −7 m, bridges clearing roads by 4.7 m, ramps within 4% (trams 6%), and the `covered` field. | |
| TASK-137 | Tram stops (`RailNetwork.tramStops`, ids `ts:` allocated last). | |
| TASK-134 | Overhead lines from `electrified`, `contactLine`, `RailNetwork.masts`; Overpass `queryVersion` 9. | |

**Current traffic baseline** (`bench/traffic-baseline.json`, Munich 0.15 to 10:00): 4,113 completed,
26 gridlocked, 0 stalled heads; quick run to 09:30: 3,777 / 12. T53's walker-cost limit is 6%
(0.94), relaxed with the owner's rule because seeds 1 to 3 give 5.3%, −6.6% and 1.6%.

## 3. Held for the owner (reviewed, not merged)

All three fail Munich's gate on seed 1 and look neutral or better on seeds 2 and 3. Main itself
gives 4,113 / 3,994 / 3,245 completed on seeds 1 / 2 / 3. Reshuffling only the starting parking
spaces moves main's seed 1 between 3,595 and 4,155, because the Landsberger loop and `r:666` jam
by different amounts each run. **The open question for the owner:** gate on the mean of seeds 1
to 3 against a three-seed baseline, or fix B56 first and then re-measure.

| Branch / worktree | Head | Status | Numbers |
|---|---|---|---|
| `task/130-landsberger-loop`, Codex worktree `C:\Users\cl2749\.codex\worktrees\0cfa\cityflows` | `215afac` | Checkpoint, not merged; review entry in the plan. It fails every B56 gate: the loop's waits are 4,600 to 6,200 s against a 900 s gate, and step time is up 38 to 51%. | On today's main with it merged: 3,704 / 4,185 / 3,977 (mean +4.5%, seed 1 −10%). The owner's options: salvage the box-forecast bound and the head-cost reuse as separately measured changes; approve its routing proposal (`avoidEntryLane` in `RouteRequest`); or fold it into TASK-131 Phase 3. |
| `task/129-car-ownership`, `D:\cityflows-wt\129` | `496cfe6` | Held; review entry in the plan. The rejected T63 floor change (3,571 to 3,300) is still on the branch: revert it before any merge. | Seeds 1 / 2 / 3: 3,344 / 4,001 / 3,668 (−18.7%, +0.2%, +13.0%; total −3.0%). `carShare` is 1 in the default scenario, so in Munich only the starting spaces move. |
| `task/128-station-trips`, `D:\cityflows-wt\128` | `c9a0632` | Held. **No review entry in the plan yet** (one is added with this doc). | Riders: 1,339 a day, 586 spawned by 10:00, 568 completed, 0 failed, 0 walk fallbacks. Cars on seed 1: 3,679 against the 3,702 floor (89.4%), 37 gridlocked (+11, the allowance is +10). An earlier version measured 3,558 / 4,074 / 3,680 over seeds 1 to 3. Making riders walk nowhere still drops seed 1, so riders crossing roads are not the cause. |

Both D:\ branches were cut before TASK-134 merged. Expect conflicts in the hash pins (T44, T49,
V107, V117), `scene.ts`, the schema files and the baseline file, and resolve them by keeping both
sides.

## 4. Open issues

- **B56, the Landsberger loop:** a deadlock cycle through Arnulfstraße eastbound, `n:138`, the
  Landsberger ramps, `r:703` and the Donnersberger ramps through `n:638`. On main, seed 1 at 10:00
  has `r:961` with 24 cars (longest wait 5,090 s), `r:364` with 17 (5,525 s) and `r:248` with 17
  (6,888 s). This is the biggest source of gate noise. TASK-121's head detours don't clear it, and
  neither does TASK-130.
- **TASK-131 Phase 3:** a car enters a junction group only if it can get through, so nothing waits
  on an inner link. It was planned to follow TASK-130 and is now the natural partner for B56.
- **T54-parking-motion:** the Munich case fails on main. It isn't in the light tier, so CI doesn't
  catch it. No owner yet.
- **Pre-existing, unassigned:**
  - the dead-end lot stub `r:2103` / `c:9407`;
  - a westbound lane gain east of `n:638`;
  - T62 and T64's 3D frame gates, which are flaky under load and skipped on CI.

## 5. Backlog and dependencies

| Item | Waits on | Surface | Suggested model |
|---|---|---|---|
| B56 fix and/or TASK-131 Phase 3 | owner's decision on TASK-130 | `src/sim/intersection.ts`, `engine.ts`, `reroute.ts`, `signals.ts` | Opus 5.5 high |
| TASK-128 / TASK-129 merge | owner's decision on the gate method | lead merge work | (lead) |
| TASK-113 mode choice | TASK-129 merged | `src/demand` | Opus 5.5 high, contract not written |
| TASK-136 level crossings | TASK-131 Phase 3, TASK-135 (done), TASK-138 for trams | rail importer, crossings, sim stop rule, renderer | Opus 5.5 high, contract not written |
| TASK-138 tram vehicles | TASK-135, TASK-136, B56/TASK-130, TASK-131 Phase 3 | sim, trains | Opus 5.5 high, contract not written |
| TASK-139 trams beside and in streets | dropped for now (owner, 2026-11-11) | | |

**What can run in parallel once the owner allows it:**
- The B56 / Phase 3 work owns `src/sim`. While it runs, merging TASK-128 and TASK-129 is lead work
  that touches `src/demand` and the baseline. A baseline reset from one invalidates the other's
  numbers, so merge them one at a time and re-measure after each.
- TASK-136's importer and drawing part could start beside B56, provided its sim stop rule waits.
  Nothing else in the backlog is independent of B56 today.

## 6. Running a task as a subagent

1. **Contract.** Write the contract `docs/tasks/TASK-<id>.md`: goal, owner decisions, In scope (a
   main surface, not a fence), Out of scope (the hard limit), gates, tests and report format. Add
   its task-table row and backlog row to `docs/plan.md`, and its row in the agent table (harness,
   model, effort, port). Commit it on `task/lead-<id>`, merge it to main and push.
2. **Worktree.** Run in PowerShell:
   ```
   git worktree add D:\cityflows-wt\<id> -b task/<id>-<name> main
   New-Item -ItemType Junction -Path D:\cityflows-wt\<id>\node_modules -Target D:\cityflows\node_modules
   ```
   To remove one later, delete the junction first, or `git worktree remove` follows it:
   `(Get-Item D:\cityflows-wt\<id>\node_modules).Delete()`, then
   `git worktree remove D:\cityflows-wt\<id>`. Never run `npm ci` (node_modules is shared), and
   run `npm install` in `D:\cityflows` only when a task adds a dependency.
3. **Brief.** Start the agent (Agent tool, background) with:
   - the branch and worktree path, inside and outside the message;
   - the files to read in order (AGENTS.md, the contract, architecture sections);
   - the surface it owns;
   - the tests and tiers to run;
   - `CITYFLOWS_TEST_PORT=53<id>` (production port +100; the ports used so far are 5326 to
     5340, plus 5290);
   - Conventional Commits, no pushing, no merging;
   - the report format, which is the commit body.

   Tell it to commit work in progress before context runs out. Two agents ran out of context on
   TASK-131, and fresh agents continued from their handover commits.
4. **Model.** Use Opus 5.5 high for sim, network or geometry work, and Sonnet 5.5 high for
   bounded visual or docs work. Never go above Opus high.
5. **Steering.** Use SendMessage with the agent id. For visual work, ask for shots at each
   checkpoint, read them yourself, and send them to the owner (SendUserFile) without waiting for
   an answer.

## 7. Reviewing and merging

- **Check the worktree first.** Run `git -C <wt> status --short` and `git log main..HEAD`. Agents
  leave untracked work and claim gates they never ran. Measure everything yourself.
- **Merge.** Create a merge branch with `git switch -c task/lead-<id>-merge` from main (check that
  the switch worked), then `git merge --no-ff task/<id>-...`. Resolve conflicts by keeping both
  sides, and recompute hash pins from the test output. Prove a moved hash by stripping the new
  field.
- **Tiers at merge.** Run `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light` and
  the task's own specs. Under load, run with `CITYFLOWS_TEST_TIMEOUT_MS=240000`. Determinism, T11,
  route-audit, T46 and city-cache time out under load and pass alone, so rerun a failure alone
  before believing it.
- **Seed noise.** Before blaming a branch for a Munich traffic change, run seeds 1 to 3 on both
  main and the branch:
  1. temporarily change `bench/import-probe.ts:248` to
     `defaultScenario('grid5x5', Number(process.env.PROBE_SEED ?? 1))`;
  2. run `npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148 --scale 0.15`
     with `PROBE_SEED` set for each seed;
  3. revert the change.

  Compare main in a separate detached worktree (`git worktree add --detach`, plus the junction).
- **Baseline.** At a merge that moves trips, the lead resets `bench/traffic-baseline.json` and
  logs it in the review entry.
- **Record.** Write the review entry in `docs/plan.md` (the review log, newest at the bottom), set
  the task row, add an owner decisions line for anything decided, then merge to main and push.
- **CI.** Run `gh run list --branch main -L 3`. `gh run list -c` needs the full SHA, and a
  docs-only push starts no run. The jobs are check, city, e2e and deploy. A CI e2e timeout on a
  slow runner deserves `gh run rerun <id> --failed` before you blame the branch. The repo is
  `Chengxuan-Li/cityflows`; Pages deploys from main.
- **Codex output.** Check that Markdown from Codex decodes as UTF-8; Codex agents have written
  Windows-1252 before.

## 8. Machine and tool gotchas

- The box is 20-core. With several agents testing at once, local timings and frame gates are
  meaningless, so look at the process list before believing a failure.
- Port 4173 often belongs to the owner's own vite preview (`D:\energyatlas-ui`). Use your own
  port, and check a vite process's command line before stopping it.
- `test:traffic` hides its totals unless run with `--reporter=verbose --silent=false`.
- Scratch scripts must live outside `node_modules` and be deleted before `npm run check`, because
  lint covers `bench/`. Never leave `.vitest/` output behind either: a stray
  `.vitest/json/output.json` once failed the format check.
- The browser pane is often hidden and draws only on demand. Take shots through
  `npm run geometry-shots` (or `bench/geometry-shots3d.ts`) instead.
- The outgoing lead's memory notes are in
  `C:\Users\cl2749\.claude\projects\D--cityflows\memory\`. A Claude Code session in `D:\cityflows`
  loads them; `cityflows-agent-review-gotchas.md` is worth reading in full.

## 9. Worktrees and branches left over

- `D:\cityflows-wt\128` and `D:\cityflows-wt\129` hold the held branches. Keep them until the
  owner decides.
- `D:\cityflows-wt\lead-r2` sits on `task/lead-134-merge`, which is already merged. It can be
  reused for lead merges after `git switch --detach main`, or removed.
- `D:\cityflows-wt\100`, `101`, `105`, `106` and `108`, and the Codex worktrees under
  `C:\Users\cl2749\.codex\worktrees\`, are old. The Codex ones belong to the owner, so leave them.
  Before removing an old D:\ worktree, check it for uncommitted work.
- Many merged `task/*` branches remain. Clearing them is optional housekeeping.

## 10. First steps

1. Read the files named at the top and `git log --oneline -15`.
2. Confirm CI is green on main (`gh run list --branch main -L 3`).
3. Settle with the owner:
   - job allocation: which tasks go to Codex and which to your subagents;
   - the gate method;
   - the direction for TASK-130 / B56.
4. Act on those answers:
   - If TASK-128 or TASK-129 is approved, rebase or merge it onto main via `task/lead-<id>-merge`.
     For TASK-129, revert the T63 floor change unless the owner approves it. Re-measure over three
     seeds, reset the baseline and record the review.
   - Write the contract for the B56 / Phase 3 work in whichever shape the owner picks, then start
     it.
