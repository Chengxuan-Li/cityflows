# TASK-174 — Transit as a mode: walk, tram or S-Bahn, walk

Owner: Claude Code subagent (Opus 5.5, high). Branch `task/174-transit-mode`, worktree
`D:\cityflows-wt\174`, ports 5374 / 5474. It starts after TASK-173. It may carry past the 24-hour
window; commit resumable milestones.

## Goal

Persons can choose transit, the third alternative TASK-113 left empty:
- **Routing:** walk to a stop or platform, wait for a scheduled tram (TASK-138) or S-Bahn (TASK-127
  timetable), ride, transfer if needed, and walk to the destination. Routing works on a time-
  expanded timetable graph.
- **Capacity:** vehicles have capacity, with a full vehicle leaving riders to wait for the next
  one. Riders are drawn boarding and alighting at platforms and are visible in the vehicle
  inspector.
- **Choice:** the logit gains a transit utility: walk access and egress, wait, in-vehicle time
  times a comfort factor, and fare times value of time.
- **TASK-128's riders:** keep the station riders as background demand, or fold them in if natural;
  report which.
- **Metrics:** mode shares gain transit.

## Scope

`src/demand` (the model), a new transit routing module, `src/sim` (rider movement and vehicle
occupancy), the inspector and metrics UI, and tests.

## Gates

- Unit tests for routing and capacity.
- A Munich census of transit share by distance and of riders per line.
- The gate with mode choice off unchanged.
- The mode-share guard updated with justification.
- `npm run check`, `test:city`, `test:e2e:light`.
- Shots of boarding and alighting.

## Report

Write it as the commit body.

## Findings

### Design note (milestone 1, 2026-11-13)

- **Stops and lines.** A stop is a platform a timetabled route calls at: TASK-138's tram stops
  (`ts:`) and the S-Bahn platforms of station places (`rp:`), from `railTimetable`, the combined
  timetable the simulation runs. Munich: 14 tram stops on four synthetic routes (two per corridor,
  one each way, every 6 min), and Donnersbergerbrücke's two platforms on two S-Bahn routes (every
  4 min). Each Munich S-Bahn route calls at one stop inside the extract, so no trip inside the city
  can ride it; residents' transit in Munich is the tram. The S-Bahn carries TASK-128's riders.
- **Access.** A tram stop is reached from the nearest walk link within 60 m on its grade (not a
  crossing link), an S-Bahn platform from its station's entrances; the last metres to where riders
  stand are a straight line times 1.3, drawn but not simulated as a crossing.
- **Graph.** `src/routing/transit.ts`: every run of a route over two days is a chain of events,
  three per stop (arrival, departure on board, departure from the platform). Arcs ride, dwell,
  wait at a stop, alight and board again at the same stop after 60 s or at another stop within a
  10 min walk. Arcs go forward in time, so one pass in time order finds the least generalized cost
  (walk and wait seconds, ride seconds times a comfort weight, a penalty per transfer). Walk
  seconds come from one one-to-all search per stop on the walk graph. Munich: 24,525 events, built
  in about 130 ms, a query in well under a millisecond.
- **Choice.** TASK-113's logit gains the transit alternative: access and egress walks, waits, in-
  vehicle time times a comfort factor, transfers, and a flat fare over the value of time; constants
  in `src/demand/mode-choice.ts`, no schema change. Car tours choose among walk, car and transit;
  tours of persons without a free household car choose between walk and transit (they had no choice
  before). Transit is offered only when its plan walks less than the direct walk. The tour's own
  draw picks by cumulative probabilities in the order walk, car, transit, so without transit every
  draw decides as before. Choice off: no tours, no transit, main's run.
- **Simulation.** `src/sim/transit.ts` follows the vehicles the simulation runs (the crossing
  controller's service ages, or the timetable where it holds nothing), with capacity scaled by
  `personsPerResident`. A rider walks to the stop (a walker), walks onto the platform and waits,
  boards the first run of a route that reaches the planned stop with room (a full one leaves them
  for the next), rides, alights at the door and walks off the platform, then transfers or walks on.
  Riders on platforms are drawn with the walkers; occupancy shows in the train inspector.
- **TASK-128's riders.** Kept as background demand (their trips and walks unchanged, so choice off
  stays main's run) and seated in the S-Bahn: they ride in on the train that brings them, alight at
  its doors and walk to the entrance, and after their walk back they wait on the platform and board
  the next S-Bahn with room.

### Census (milestone 4, 2026-11-13)

Munich at 0.15, 07:00 to 10:00, mode choice on (fare 0.5 EUR, in-vehicle x 1.1, 5 min per
transfer), trips of tours started by 10:00:

| Seed | Local trips | Walk | Car | Transit | Transit < 0.5 km | < 1 km | < 2 km | Vehicle trips completed |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 7,021 | 77.6% | 21.6% | 0.80% | 0.2% | 0.6% | 1.9% | 2,560 |
| 2 | 7,035 | 78.5% | 20.2% | 1.28% | 0.2% | 1.5% | 2.1% | 2,505 |
| 3 | 7,035 | 78.6% | 20.9% | 0.54% | 0.2% | 0.4% | 1.3% | 2,531 |

Transit trips started by 10:00: 28 / 45 / 19 (seeds 1 / 2 / 3); none gave up, none was left by a
full tram (32 places at 0.15). Gridlock 0, stalled heads 0 on every seed. Seed 1 riders per line
(residents boarded; TASK-128 riders off / on; most aboard of the places): tram westbound to
Barthstraße 20 (most aboard 3 of 32), eastbound to Schrenkstraße 2, eastbound to Deroystraße 4,
westbound to Burghausener Straße 2; S-Bahn northeastbound 0, 296 off, 0 on (8 of 163); westbound
0, 292 off, 0 on (8 of 163). TASK-128's commuters stay a working day, so none boards before 10:00.
Busiest tram stops: Schrenkstraße 14 boardings, Barthstraße 16 alightings. Mean wait 80 s (max
298 s). The mean offered plan walks 12 min, waits 3 and rides 1 against a 15 min walk: inside a
1.5 km district a tram ride saves little walking, which keeps transit near one trip in a hundred.

Step time, seed 1 to 10:00, side by side with main 96d6a34 on the same loaded machine: choice off
226.9 s against 229.7 s (state hash 2045295651 on both, 5,310 / 0 / 0); choice on 32.9 s against
33.7 s. The transit network builds in about 130 ms per load; a transit query takes well under a
millisecond.

### UI and previews (milestone 5)

`tests/e2e/T80-transit.spec.ts` (rail group e, Munich) imports Munich, checks that an S-Bahn run
carries its riders in and that they stand on the platform after it stops, opens one in the person
inspector, finds a tram standing with a rider at its door and opens the train inspector (riders
against places), and reads transit and riders per line in the Chart section's mode shares at 09:30.
With `CITYFLOWS_SHOT_DIR` it saves the five previews. Checked by eye: S-Bahn riders step off the
doors onto the platform, not onto the tracks or the far side; the tram rider stands at the leading
car beside the island; the purple transit share is a sliver at 1%.
