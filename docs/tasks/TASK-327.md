# TASK-327 — Runway interlocks at intersections only

Status: in progress 2026-11-23 (owner: "bos also legitimate finding - fix"). Proposed owner: Codex CLI (gpt-6.2-sol,
high). Branch `task/327-runway-interlocks`, worktree `D:\cityflows-wt\327`, ports 5527 / 5627.

## Finding (lead, 2026-11-23, real sim, main 5fdbbce)

`runwayInterlocks` in `src/sim/aircraft.ts` gives each runway the set of every runway that shares a node with it,
and occupancy is written to and checked on the whole set (`bookingFits`, the approach decision in `stepAir`, the
crossing and line-up grants). At Boston the sets chain through runways nobody uses: an arrival on 22L occupies
15R/33L and 15L/33R, which are in 22R's set too, so

- a departure on 22R waits for every 22L arrival, and the two parallels work as one runway;
- every taxi crossing of 15R/33L, 15L/33R or 09/27 (not in use in the configuration) waits for 22L traffic.

Seed 1, 1,000 movements a day: 352 completed (186 landed, 166 departed), 125 go-arounds. Wait roots at 09:35: a PC24
at the 22R line-up and an SF34 at a 22R crossing, both waiting on `4L/22R` with occupant -1 while `15R/33L` and
`15L/33R` show the 22L arrival as occupant. Clip: `D:\cityflows-wt\lead-evidence\video\boston-real-sim.mp4`.

## Goal

Protect what physically conflicts, and nothing more:

1. An aircraft using a runway (landing, take-off, line-up, crossing) occupies that runway, and of each runway it
   intersects only the **intersection area**, plus the protection margin the sim already uses. An aircraft
   whose movement on another runway does not reach that area does not conflict with it. A take-off or landing
   roll that passes an intersection holds the area until its tail is clear. A crossing or roll on the
   intersecting runway that would enter the area waits.
2. A runway the configuration does not use for arrivals or departures is still a runway: crossings keep their
   hold and grant. The grant then depends only on aircraft actually on, or bound for, that runway or its
   intersection areas, not on traffic on runways it merely touches.
3. Where the configuration does use intersecting runways (Zurich north concept: take-offs 16 and 28), the
   intersection areas make them dependent where they really meet. Make it no more restrictive than that.

## Scope

`src/sim/aircraft.ts` (interlock sets, occupancy and booking per runway or intersection area), and
`src/network/airside.ts` if the compiled graph should carry intersection areas, with tests. No schema change.

## Gates

- Tests:
  - On a synthetic crossing-runway layout (build it in the test, like the existing aircraft tests): a
    departure on runway A is not held by an arrival on runway B whose roll ends short of the intersection, and
    is held when it would reach the area.
  - A crossing of an unused runway is granted while traffic is on a runway that intersects it elsewhere.
  - No runway conflict or body overlap (`tests/sim/aircraft-checks.ts`).
- Real sim, `bench/airside-delay.ts --checks`, full day, seeds 1–3, your branch against your base:
  - **Boston** (1,000): completed movements, go-arounds, gridlocks, taxi-out and taxi-in times, runway
    conflicts (must stay 0);
  - **Zurich** at 730, and **London City**: same table, to show no regression where runways intersect or do
    not.
- Airports batch merge rule (existing cities unchanged), `bundled-airport-load` re-pinned only if a startup
  state changes (say why), `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
