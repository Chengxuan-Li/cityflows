# TASK-334 — Generic tube and New York subway trains

Status: planned 2026-11-23 (owner: "good with the decisions + 1 generic tube style train and 1 generic nyc subway
train"). Starts after TASK-332 merges; may run after or beside TASK-333 if it touches only its own variant records.
Proposed owner: Codex (gpt-6.2-sol, high). Branch `task/334-subway-trains`, worktree `D:\cityflows-wt\334`, ports
5534 / 5634.

## Goal

Add two variants to TASK-332's kit as data records. The variant rule, levels of detail, performance budget and
drawing-only decision are TASK-332's.

1. **Generic London tube train** (routes mostly on `subway` track in left-hand-traffic cities: Heathrow's Piccadilly
   line).
   - Body: the small deep-tube profile, about 2.6 m wide and 2.9 m tall, with the roof following the tunnel's circle
     and the doors cut into the roof curve.
   - Doors and windows: two double doors and two single doors per side per car.
   - Ends: a flat cab front at each end of the train.
   - Running gear: no pantograph; current-rail shoes.
   - Colours: red doors, white and blue body, red front.
   - Within the sim's 25 m car poses, draw the real 16–18 m car centred and leave the gap between cars as gangway
     space. Do not stretch it.
2. **Generic New York subway train** (routes mostly on `subway` track elsewhere: Philadelphia's Broad Street,
   Market-Frankford and PATCO lines).
   - Body: R160-like, about 18 m long (drawn like the tube car), 3.0 m wide, with flat stainless-steel sides and
     a fluted lower skirt.
   - Doors: four double doors per side.
   - Ends: a flat cab end with an end door on cab cars and storm doors between cars.
   - Colours: a brushed silver body, a coloured line-indicator band near the roof (one neutral colour; no route
     bullets).
   - Running gear: no pantograph.

## Scope

TASK-332's variant files (small, general builder extensions only), tests, `docs/architecture.md`.

Out of scope: the sim, `src/schema`, the 2D layer, TASK-332's rule (change it only to stop the stand-in fallback for
these two), `bench/traffic-baseline.json`, any download or new dependency.

## Gates

- Tests:
  - Both records build within TASK-332's budgets.
  - Heathrow's Piccadilly routes get the tube train; Philadelphia's three `subway` lines get the New York train.
  - The drawn car length is the stated real length, centred in the 25 m pose.
- Screenshots, day and night: both close up; the Piccadilly line at Heathrow where it runs above ground; Philadelphia
  where the lines surface (or the portal if none does). The lead forwards them to the owner as they land.
- 3D render p95 within noise of main at Heathrow and Philadelphia (TASK-332's method).
- Sim state hashes identical; 2D identity hashes identical; `npm run check`, `test:city`, `test:traffic:light`,
  `test:e2e:light`.

## Report

Write it as the commit body.
