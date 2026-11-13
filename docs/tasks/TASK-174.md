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
