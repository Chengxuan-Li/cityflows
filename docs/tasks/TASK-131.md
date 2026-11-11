# TASK-131 — Junction groups: keep OSM geometry, treat close nodes as one junction

Owner: the lead drives this task through a Claude Code subagent from the lead's session (owner
exception, 2026-11-10, as for TASK-111). The agent works phase by phase and reports to the lead at
each checkpoint; the lead shows the owner the checkpoint shots before the next phase starts.
Gate: 5 (road geometry), B54 amended, B55 reopened (owner, 2026-11-10)
Branch: `task/131-junction-groups` (created by the lead from main)
Depends on: TASK-099 (lateral shift profiles), TASK-092 (curbs), TASK-094 (stop lines), TASK-111
(pedestrian phases). Phase 3 also depends on TASK-130 (the Landsberger loop), which may add a
box-entry rule.
Runs alongside:
- **TASK-128 and TASK-129** work in `src/demand`, `src/sim/parking.ts` and `persons.ts`.
- **TASK-130** works in `src/sim/engine.ts`, `intersection.ts`, `reroute.ts`, `lane-change.ts`
  and `merge.ts`.

Phases 0 to 2 stay out of all of those. Every task resets the traffic baseline at its merge
(owner rule 7).
Design: this file; `docs/architecture.md` sections 4 and 5 (nodes, junction shapes, signals), 8
(intersections) and the importer section. Read B48 to B55 in `docs/plan.md` ("Owner findings"),
`docs/tasks/TASK-089.md`, `TASK-095.md` and `TASK-099.md`, and their review entries.

## Goal

The owner (2026-11-10):

> "We should really try to preserve the geometry as they are."

A street with two carriageways is two OSM ways. Where it crosses another road, OSM has two
crossing nodes a few metres apart. Today the import merges them into one node:
`consolidateJunctions` (`src/importers/osm/split.ts`) does the following.
- **Clusters:** it takes clusters of nodes joined by roads under 30 m, up to 60 m across.
- **Merging:** it moves them to their mean position, deletes the roads between them, and drops
  every road point within the cluster radius plus 5 m.
- **The damage:** the arms then meet at acute angles, and the junction shapes break.

Five later passes move road lines to repair the damage: `smoothRoads`, `realignRoads`,
`separateCoincident`, `separateDual`, `attachCarriageways`, and the collision model `relaxRoads`.
Each fixed the one before. B54 east and B55 are what remains.

This task starts again from the map:
- **Node positions:** every OSM node keeps its position.
- **Junction groups:** nodes joined by a short link form a junction group, controlled and drawn as
  one junction.
- **Inner links:** a link between two nodes of one group is an inner link. It stays a real road,
  with its true length, routed and simulated. It is not drawn or marked as a road of its own.
  A car is never cleared into an inner link unless it is cleared through to its exit, so it never
  stops between the two nodes (where a tram track may run).
- **Long links:** nodes joined by a longer link stay separate junctions, with their own markings
  and signals.

## Owner decisions (2026-11-10)

1. **Threshold.** Two nodes group when the link between them is at most `junctionGroupMaxM`, an
   import option, default 30 m (the owner: 20 to 30 m covers waiting areas inside a junction, as
   around Donnersbergerbrücke). It may be changed during the task.
2. **Carriageways.** The two carriageways of one street stay semantically paired (one corridor).
   - **Gap:** where their real gap leaves positive space between the lane blocks, they are drawn
     where they are. The median shows as it is: tram tracks, a verge, anything or nothing. No
     divider line is drawn.
   - **Overlap:** where they overlap or leave no space, they are joined side by side with a centre
     divider line. B54's rule holds there.
   - **B54:** this amends B54; it does not withdraw it.
3. **Passes.**
   - **Smoothing stays,** but it must not move junctions (node positions and the road ends at
     them).
   - **The collision model is turned off** (`relaxMaxM` 0 by default), not deleted.
   - **The other passes** (`realignRoads`, `separateCoincident`, `separateDual`,
     `attachCarriageways`) are reduced to what decision 2 needs, or turned off where the audit
     shows the groups make them unnecessary. Each pass's fate is a Phase 0 finding the lead
     approves.
4. **Signals.** The nodes of a group are coordinated as one signal controller: one program for the
   group. Stop lines stand only where roads enter the group.
5. **B55** is in scope: different streets meeting a node nearly parallel (Sindelfingen `n:841`,
   `n:68`) get the same keep-the-geometry treatment.

## Phases and checkpoints

Each phase ends with a commit and a report to the lead. Do not start the next phase until the
lead says so.

### Phase 0 — Audit (read only, no source changes)

On main, for Munich and Sindelfingen as imported today (use `bench/geometry-audit.ts`,
`bench/geometry-shots.ts` and the city cache), report:
1. **Merged clusters.** Every node with `junctionConsolidation` provenance and every node merged
   by `mergeShortRoads` and `joinDividedFeeders`:
   - its OSM nodes;
   - the deleted inner roads with their lengths;
   - how far each OSM node moved;
   - the arm angles before and after.

   Classify each cluster:
   - dual carriageway × single road;
   - dual × dual;
   - carriageways merging or splitting;
   - roundabout;
   - ramp;
   - other.
2. **What the passes move.** Per pass, the displacement of road lines from their OSM position
   (median, 90th percentile, maximum, and the ten largest with road ids), separately within 30 m
   of a node and elsewhere.
3. **Medians.** For every paired carriageway, the gap between the lane blocks at their OSM
   positions, as a distribution and per corridor. List where it is negative or under 0.5 m.
4. **The reference cases.** Shots at the same scale, 2D, of today's import against the OSM lines
   (raw way geometry drawn on top):
   - Munich: `n:138`, `n:638`, `n:967`, `n:263`, `n:936`, `n:247`;
   - Sindelfingen: `n:841`, `n:68`;
   - the five worst clusters of the audit.
5. **B56.** Whether `n:263`, `n:638`, `n:967`, `n:936` and `n:247` are merged clusters, and with
   what inner roads.
6. **A proposal.** The groups the 30 m threshold would form, counted by class, with the borderline
   cases between 20 and 40 m listed. Then, for each pass, keep, reduce or turn off, with the
   evidence.

Checkpoint 0: the lead reviews the report and the shots with the owner, and chooses the reference
cases and the passes' fate.

**Checkpoint 0 outcome (owner, 2026-11-10; audit `d4a5918`).** The owner approved the lead's
recommendations.

The passes:
- `consolidateJunctions` is replaced by groups;
- `realignRoads`, `attachCarriageways` and `relaxRoads` are turned off;
- `separateCoincident` and `separateDual` act only where carriageways overlap or leave no space;
- `smoothRoads` never moves a node and does not smooth within 30 m of a node; Gate 2's 0.5 m bound
  stays;
- `mergeShortRoads` and `sampleSameDirection` stay.

The rest:
1. **B54's Arnulfstraße corridors** (real medians 6 to 8 m at `n:138` and `n:638`) are drawn apart
   at their OSM positions, without a divider. This undoes TASK-099's attachment there.
2. **`joinDividedFeeders`' synthetic median crossings** (36 in Munich) stay, as inner links of
   their groups that are not drawn. Whether they allow turns that do not exist is a later
   question.
3. **`convergingShifts`** (`src/network/continuity.ts`) applies decision 2 too: it brings
   carriageways together only where they overlap or leave no space.
4. **Dead ends** do not form groups.
5. **Today's two cluster rules stay:** a group spans at most 60 m, and a road of 30 m or more
   inside a candidate group splits it.
6. **B55.** `n:841`'s id has moved since round 6; `n:68` is the known case. Phase 2 finds every
   near-parallel overlap in both cities (different streets within 15 degrees of each other that
   overlap near a node) and lists them for the owner.
7. **The `n:967` reference** is `n:247` since TASK-101.

### Phase 1 — The model

1. **Schema.** A junction group in the city model, set at import, saved, and editable later. A
   suggested shape, to be confirmed with the lead before coding:
   - `City.junctionGroups?: Record<JunctionGroupId, JunctionGroup>`;
   - `JunctionGroup { id; nodes: NodeId[]; innerRoads: RoadId[]; control; signal: SignalProgram | null; provenance }`;
   - the member nodes keep their own positions and turn rules, and their own `control` becomes the
     group's.

   An old project without groups loads unchanged: no groups, and today's behaviour.
2. **Compile.** Groups compile to a `CompiledCity` index:
   - each node's group;
   - each road's inner flag;
   - the group's entry and exit road ends;
   - the movements through the group as chains of member-node movements.
3. **Signals.** One group program. Its green groups name entry and exit roads of the group. They
   compile to the member nodes' movements along the inner links, so one green clears a car from
   the entry to the exit. Pedestrian phases (TASK-111) stay per crossing.
4. **Import.** Group the nodes joined by roads of at most `junctionGroupMaxM`. Keep the existing
   exclusions:
   - bridges keep their own junctions;
   - roundabout rings;
   - motorways;
   - restriction via nodes;
   - access changes on the inner road.

   Stop merging those nodes in `consolidateJunctions`. Keep merging only true artefacts, such as
   nodes under 1 m apart; say which. Turn OSM restrictions and the turn rules the merge used to
   write into rules at the member nodes.

Checkpoint 1: unit tests of the model and the compile. The lead reviews the schema and the compile
before any drawing.

### Phase 2 — Geometry and drawing

1. **Passes.** Apply the Phase 0 decisions:
   - `relaxMaxM` defaults to 0;
   - smoothing never moves a node or the road ends at it;
   - the carriageway passes are reduced to decision 2: side by side with a divider only where the
     blocks overlap or leave no space.
2. **Junction surface.** A group is one junction surface: the member nodes' junction shapes
   (`src/network/junctions.ts`) joined across the inner links, with curbs only on the group's
   outside.
   - **On inner links:** no centre line, no lane line, no stop line and no crossing.
   - **At group entries:** stop lines and crossings stand where roads enter the group.
   - **Rail:** a tram track or rail crossing on an inner link stays drawn.
3. **B55.** Different streets meeting a node nearly parallel keep their OSM lines up to the node,
   with an edge line between them where they touch.
4. **Shots.** The reference cases at the same scale as Phase 0, before and after, 2D and 3D.
   Check them yourself against the OSM lines first.

Checkpoint 2: the lead and the owner review the shots. Geometry tests that pinned moved shapes
(T36, T39, T41, T42, T43, T45 and their named exceptions) are rewritten or retired, each named
with its reason.

### Phase 3 — Simulation (after TASK-130 merges)

1. **The box rule.** A car enters a group only when every inner link on its path through the group
   and its exit lane beyond the group have room for it. Use TASK-130's box-entry rule if it
   landed, extended across the inner links; otherwise add it here.
2. **Inner links never hold a queue.**
   - **Who stops there:** only a car that entered when the way was clear and was then stopped
     (gridlock recovery, live edits).
   - **The gate:** at 10:00 no car stands on an inner link for more than `boxWaitS`.
   - **Report:** cars standing on inner links over time.
3. **Routing.** Routing crosses the inner links as roads with their true lengths; link costs
   include them.

Checkpoint 3: the traffic gates below, then the owner's acceptance.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file the
feature needs in order to be wired in, type-check or be tested, as long as it is not named under
"Out of scope"; list each such file and why in your report. Stop and ask the lead only for a file
named under "Out of scope", a contract change this task does not describe, or a behaviour change
to another feature.

Pre-approved, no need to ask:
- `src/importers/osm/**` (`split.ts`, `corridors.ts`, `realign.ts`, `relax.ts`, `smooth.ts`,
  `controls.ts`, `turns.ts`, `index.ts`), `src/importers/types.ts` (`junctionGroupMaxM`, the
  `relaxMaxM` default);
- `src/schema` (the junction group, a migration that leaves old cities unchanged), `src/network/**`
  (compile, junctions, continuity, corridor, lanes, movements, conflicts, signals, stops,
  crossings);
- the renderers for roads, junctions and markings in 2D and 3D; the node inspector and the signal
  editor (show and edit the group's program);
- in Phase 3 only: `src/sim/intersection.ts`, `src/sim/signals.ts` and `src/sim/engine.ts` (entry
  checks), after TASK-130 merges;
- `docs/architecture.md` sections 4, 5, 8 and the importer section;
- `bench/geometry-audit.ts`, `bench/geometry-shots.ts`, `bench/import-probe.ts`,
  `bench/traffic-baseline.json` (the lead re-records it), the city cache key;
- tests: new `tests/importers/T68-junction-groups.test.ts`, `tests/network/T68-junction-groups.test.ts`,
  a T68 e2e spec for the inspector and shots, the geometry tests named in Checkpoint 2, and the
  traffic tests' expected counts and hash pins that move, each named with its reason.

## Out of scope

- `src/demand/**`, `src/sim/parking.ts`, `connectors.ts`, `persons.ts`, `walkers.ts` (TASK-128,
  TASK-129).
- `src/sim/**` before Phase 3; `reroute.ts`, `lane-change.ts`, `merge.ts` at any time
  (TASK-130).
- The rail network and trains, walk network topology (walk links follow the drawn crossings only).
- New lane-geometry features beyond decisions 2 and 5.

## Gates

1. **Model.** In T68, on synthetic OSM fixtures:
   - **Dual × single:** a dual carriageway crossing a single road imports as two nodes at their
     OSM positions in one group, with the inner links kept, their lengths true, and no road point
     moved.
   - **Long link:** a link longer than `junctionGroupMaxM` leaves two separate junctions.
   - **Same movements:** turn permissions through a group equal those the merge used to give.
   - **Signals:** one program clears entry to exit, and no stop line stands on an inner link.
   - **Old projects:** an old saved city loads with no groups and today's compiled result.
   - **Determinism:** same import, same city hash.
2. **Geometry.** The reference cases:
   - every node within 0.01 m of its OSM position;
   - no road line moved more than 0.5 m within 30 m of a node, except by decision 2's side-by-side
     join, which is reported per corridor;
   - no lane block overlap between roads that are not paired (the relax gate T36 measures, now
     without relaxation);
   - every junction surface valid (T38/T42's polygon checks), with no acute corner left by a
     merge.

   Report every case that fails, with a shot.
3. **Traffic** (Phase 3).
   - **Munich 0.15 to 10:00, seeds 1 to 3, against main:**
     - completed at least main's;
     - gridlocked at most main's mean;
     - parking failures at most main's;
     - 0 stalled heads;
     - no car on an inner link longer than `boxWaitS` at 10:00.
   - **Sindelfingen 0.15 and the full-demand test:** report against main.
   - **T53** passes at 5%.
   - The baseline resets at merge.
4. **Performance.** Import time and compile time for Munich and Sindelfingen, and step time,
   within 10% of main; report each.
5. **Checks.** The light tier (AGENTS.md "Delivering a task"):
   - `npm run check`, `npm run test:city`, `npm run test:traffic:light` and
     `npm run test:e2e:light` are green;
   - so are T16-performance, T26, T38, T41, T42 and `demo-c-bypass`.

   Run e2e with `CITYFLOWS_TEST_PORT=5332` and `CITYFLOWS_PRODUCTION_TEST_PORT=5432`; never use
   port 4173, 5173 or 5174. Do not run the whole `npm run test:e2e`, `npm run test:traffic` or
   `npm run bench`.

## Acceptance

The owner reviews the reference cases in the app (`npm run dev -- --port 5332`):
- Munich and Sindelfingen imported, at the reference nodes in 2D and 3D;
- then Munich at 0.15 played from 07:00 to 10:00 around Donnersbergerbrücke.

## Deliverable

A report per phase in the body of that phase's last commit message (no new Markdown files):
- what changed;
- the counts and shots against main;
- files outside the pre-approved list and why;
- expectations changed with their reasons;
- for the last phase, the final lines of `npm run check`.

Report every timing that grew against main.

Commit on `task/131-junction-groups`; do not push or merge. The lead reviews only commits.
