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
