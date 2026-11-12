# TASK-138 — Timetabled tram vehicles

Run deterministic trams on the imported tram network and stop at served tram stops.
Use the existing timetable, train poses and rail renderers where they fit. Keep the
existing rail service intact. Follow connected tram tracks, use sensible tram length,
speed and dwell, and handle the bounded extract without teleporting between disconnected
tracks. Munich is the reference. If mapped service relations are absent, use a clearly
identified synthetic service. Report served stops, tracks with service and any exclusions.

The tram agent owns network timetable and tram stop attachment, vehicle drawing in both
views, inspection and focused timetable tests. Coordinate an additive typed interface
with the TASK-136 agent. The crossing controller owns priority over conflicting cars at
mapped crossings. Honour road signals through that controller. The integration test
must show a tram passage, actual car yielding and resumption, and consistent signals and
poses in both views. Keep TASK-139's road realignment and shared-lane running deferred.
Passenger trips and mode choice belong to the separate held and dependent tasks.

Test deterministic service, stops and dwell, valid connected sections, reverse travel,
separate train and tram paths and old cities without trams. Exercise the real Munich map
in 2D and 3D and provide named close-up shots. Run check, city, the relevant train and
tram tests, light e2e and light traffic. Use ports 5348/5448. Commit on the task branch,
with the chosen defaults, changed expectations and measurements in the commit body.
The lead integrates crossing priority after the two independent parts are reviewed.
