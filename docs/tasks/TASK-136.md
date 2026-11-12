# TASK-136 — Level crossings

The first delivery imports mapped rail and tram crossings and draws the equipment at road level
in 2D and 3D. It runs alongside TASK-131 Phase 3 on `task/136-crossing-visuals`. Train stop
rules follow Phase 3. Tram interaction follows TASK-138. The lead tracks those remaining parts.

## In scope

Inspect the bundled extracts and the existing rail-node, road and height representations first.
Recognize `railway=level_crossing` and `railway=tram_level_crossing`. Preserve useful mapped
barrier, light and bell information. Distinguish road crossings from pedestrian crossings and
grade-separated passes. Rail crossings have gates, St Andrew's crosses, lights and road markings.
Tram crossings have tram signals. Position and orient equipment for the actual road approaches,
clear of the running tracks. Use the same placement in 2D and 3D.

Own rail schema, importer, crossing compilation and drawing, their scene hooks and focused T75
tests. Extend saved rail data compatibly and document the representation in the rail sections
of the architecture. The simulation, demand, traffic gate and TASK-131 group rules are outside
this delivery.

## Acceptance

Import and round-trip railway and tram examples. Test equipment, orientation and absence of
false crossings. Report a census on both extracts. Exercise the app, supply close 2D and 3D
shots of each kind, and identify the location or synthetic fixture for each. Send the lead the
first reviewable shots during implementation and the verified final paths. Run check, city,
light traffic, light e2e and T75. Use ports 5336/5436. Report the commit, counts, checks,
changed pins with explanations, and outstanding simulation work. Commit only on the task branch.

## Second delivery — operating crossings on main

B56 is deferred. Use the merged road geometry, timetable and compiled crossing facilities.
Protect each mapped, at-grade road approach served by a scheduled train or tram. Start warning
early enough for legal braking, hold approaching traffic at the painted stop line, let
vehicles already committed clear, and release only after the last carriage clears every
conflicting track. Consecutive or opposing services must keep protection continuous.
Prevent entry into a crossing without space to clear the tracks. Account for stopped queues,
vehicle length, lane and junction movements. A train or tram must never pass through a
stranded road vehicle. Preserve normal signal right of way on release and handle restart
and live edits deterministically. A facility without service stays open.

The sim agent owns crossing control, any necessary per-lane compile data, sim/host state
and focused safety tests. The render agent owns dynamic arms, lamps and tram signals in
both views and browser tests. Both use the same authoritative simulation state for the
facility, including during pause, stepping and switching views. Agree its representation
with the lead before wiring it. TASK-138 supplies tram services independently. Keep the
schema compatible and avoid touching the held worktrees.

Prove a car stops and resumes, a long vehicle clears, overlapping rail services stay
protected, a blocked crossing remains safe, and grade-separated, pedestrian-only and
unserved crossings have no road effect. Check an actual vehicle interaction end to end,
including a tram, and take open and protected 2D and 3D shots. Run T75, crossing safety
tests, check, city, light traffic and light e2e. Sim port 5344/5444, drawing 5346/5446.
Report fixture coverage, road traffic impact, measurements and any unsupported topology.
The lead verifies the existing traffic gate and reviews the combined result before merge.
