# TASK-155 — Sindelfingen gateway trips that cannot reach local parking

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch
`task/155-gateway-components`, worktree `D:\cityflows-wt\155`, ports 5355 (production 5455).
Queued by the owner on 2026-11-13; it starts at once.

## Problem

The TASK-122 trace (2026-11-09, plan review log) found that Sindelfingen at 0.15 fails 245 trips
by 10:00. Every one starts at a gateway with no parking facility or space nearby:

| Gateway | Failed trips |
|---|---|
| p:1303 | 108 |
| p:1306 | 108 |
| p:1315 | 29 |

These gateways sit on motorway pieces that the extract's crop cuts off: their components have no
path to local parking. `connectors.spawn` labels the failed route `no_parking` because the
destination requires parking. TASK-122 asked the lead for a decision on gateway routing and
failure attribution, and none was taken. The TASK-131 review saw the same pattern later:
Sindelfingen completed 155 of 445 released trips, with 49 route failures and 241 parking
failures.

## Goal

Fix this at its source, so that no trip is generated that can't possibly be served, and so that
a failure that does happen is labelled with its real reason. Two rules:
- A gateway only generates trips to destinations its component can reach legally by car: through
  traffic to other gateways, or destinations with reachable parking.
- A gateway whose component reaches nothing generates nothing, and the importer or demand reports
  why with a diagnostic.

Prefer the general rule over special cases. Check whether Munich has any gateway like this, and
report it.

## In scope

- Gateway and through-trip generation in `src/demand/` (`through.ts`, the gateway parts of
  `schedule.ts` and related files).
- Gateway place creation in `src/importers/osm/places.ts`, only if a gateway's attributes are
  wrong at import.
- Failure attribution in `src/sim/connectors.ts`: `no_route` and `no_parking` labelled by real
  reason.
- Diagnostics and tests.

## Out of scope

- `src/sim/parking.ts` (TASK-153).
- Intersections and engine flow (TASK-154).
- Lot geometry (TASK-152, TASK-156).
- The traffic gate and its floors.

## Gates

1. Sindelfingen at 0.15 to 10:00: none of the 245 gateway failures remain as unservable trips.
   Report released, completed and failed by reason, before and after. Check that the gateway
   demand that is still served behaves the same as before.
2. Munich: if no Munich gateway is affected, the seed-1 gate must give main's exact state hash.
   Otherwise the unchanged gate applies (at least 3,702 completed, at most 39 gridlocked, 0 stalled
   heads, 0 parking failures). Report seeds 2 and 3.
3. A focused test: a cut-off gateway component generates no unservable trips, with a diagnostic,
   and a connected gateway is unchanged.
4. `npm run check`, `test:city`, and `test:e2e:light` on port 5355.

## Report

Write it as the commit body: the cause as found, the rule as built, before and after counts in
both cities, the gates, hashes moved and why, files touched, and anything left open.
