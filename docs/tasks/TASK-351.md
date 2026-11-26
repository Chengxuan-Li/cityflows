# TASK-351 — Where a car can leave from when the public road network splits

Status: proposed 2026-11-25 (owner: "a new task to redesign ..."). Owner: to be dispatched. Base: main.

## Finding (TASK-349, 2026-11-25)

Zurich Airport still fails the showcase gate after TASK-349's tram-crossing fix: 2 trips gridlocked, worst visit
6,479 s on `r:4129`. The cause:

1. At import, `connectCarExits` (`src/importers/osm/places.ts`) moves the entrance of any place a car could not drive
   away from. It moves it to the nearest lane of the circulation core that `parkingEgress`
   (`src/network/parking-egress.ts`) computes, with no distance limit.
2. That core is the largest strongly connected part of the public road network.
3. In the extract, Kloten and the airport landside connect only through private or no-access airport roads, so the
   public network splits apart. The core becomes Kloten's 473 lanes; only 626 of 4,269 lanes count as places a car
   can leave from.
4. 173 entrances end up on one 204 m service road (`r:4129`), some from places 1–2.3 km away, for example `p:6596`,
   `p:6862`, `p:6924`. Another 94 end up on `r:4949` and 81 on `r:905`. Cars circle a small loop until it jams.
5. The simulation uses the same core to judge which parking a car can leave, so cars head for distant roadside
   parking.

A candidate rule was tested, not committed: count reaching a map exit (a gateway) as able to leave, and entering
from one as able to arrive. The patch is `D:\cityflows-wt\330-pilot\R\t349\egress-gateway-seed.patch`. With it:
- entrances stay near their buildings;
- 0 gridlocked, worst visit 300 s;
- but parking failures rose from 4 to 700 (36% against the 2% limit), and walk-route failures from 0 to 1,432;
- it changed every city's lanes a car can leave from, and all seven panel archives.

## Goal

A rule for where a car can leave from (and arrive at) that holds when the public network splits:
- entrances are placed near their building, with a distance limit;
- parking near the airport stays usable;
- no OSM edits and no per-id curation.

Zurich then passes the showcase gate and joins the New city panel, as TASK-349 describes.

## Gates

- Zurich showcase gate passes.
- All panel places' showcase gates pass.
- Your traffic merge rule for every city whose lanes change:
  - Munich delay within 3%;
  - full demand within 2% on the mean of seeds 1–5;
  - Freiburg within 5 s;
  - drain criterion met.
- Archives rebuilt, with reasons.
- Parking failures ≤ 2% and walk-route failures 0 everywhere.
- Light tiers, plus `tests/e2e/real-places.spec.ts`.
