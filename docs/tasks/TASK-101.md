# TASK-101 — Restricted road access: closed roads, local-traffic-only zones, delivery and bus lanes

Owner: unassigned
Gate: 7 (road betterment, owner 2026-11-07); Phase 1 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/101-road-access` (created by the lead from main)
Depends on: TASK-090 (tiers). Design: this file; `docs/architecture.md` sections 4 (City), 5
(compiled model), 7 (routing) and 13 (OSM import). Read those before the code.

## Goal

The owner: "restricted road access for certain types of cars, or cars with certain (e.g. local)
destinations". Today a road is open to every class unless a lane's `allowed` list excludes it,
the importer sets every lane to `car`, `truck`, `bus` regardless of OSM tags, and nothing
models "Anlieger frei" (local traffic only), private roads, delivery-only streets or bus lanes.
Through traffic therefore cuts through residential streets that real drivers may not use.

Add an access rule per road and class, import it from OSM, make routing obey it, and let the
road inspector edit it. Drawing signs and `BUS` lane text is TASK-107's job, not this task's.

## Design

1. **Schema (contract change, owner-approved).** One optional field on `Road` in
   `src/schema/city.ts` and `city.schema.ts`, described in `docs/architecture.md` section 4:

   ```ts
   export type AccessValue = 'yes' | 'no' | 'destination' | 'delivery' | 'private';
   // Road:
   access?: { all?: AccessValue } & Partial<Record<VehicleClass, AccessValue>>;
   ```

   - A class's rule is its own entry, else `all`, else `yes`. Absent means open to all, so old
     files load unchanged; no `schemaVersion` bump.
   - Key the record by `VehicleClass`. TASK-100 adds `van` to that type in parallel; write
     nothing that lists the classes by hand outside one constant, and the lead adds `van` at
     merge.
   - Lane reservations stay on `Lane.allowed` (a bus lane is a lane whose `allowed` is
     `['bus']`).
   - An edit command sets or clears `access` (one undo entry) and bumps `city.version` like any
     road attribute edit (`src/editor`).
2. **Compile.** `compile()` resolves each road's rule per class into `CRoad.access` (a small
   per-class array) and computes access zones per class: the connected sets of roads whose rule
   for that class is `destination` or `private` (roads joined through a shared node). Each road
   gets `zone[class]`, `-1` when unrestricted.
3. **Routing.**
   - `no` removes the road from that class's graph, the same way a lane forbidding the class
     does today (`src/routing/graph.ts`).
   - `destination` and `private`: a route may use a road of zone `z` only when the route's
     origin road or its destination connector's road lies in zone `z`. Implement it as a
     per-request edge filter in the path and lane searches (`search.ts`, `lane-search.ts`,
     `index.ts`), not as one graph per origin.
   - `delivery`: usable by a request whose `purpose` is `delivery` (add
     `purpose?: 'private' | 'delivery' | 'service' | 'taxi' | 'through'` to `RouteRequest`;
     TASK-100 adds the same field and fills it from the trip, and the lead merges the two).
     Without a purpose, `delivery` acts like `no`.
   - A request that can only be met by breaking a rule fails with the existing reason
     `class_forbidden`; the router never silently ignores a rule.
   - Keep the route cache and the graph cache correct: the cache key includes what the filter
     depends on (zone of origin and destination, purpose).
4. **Import.** `src/importers/osm/roads.ts` reads, per way: `access`, `vehicle`,
   `motor_vehicle`, `motorcar`, `goods`, `hgv`, `psv`, `bus`, `maxweight`, `maxheight` and
   their `:forward` / `:backward` forms on two-way streets.
   - Values: `yes`, `permissive`, `designated` → `yes`; `no` → `no`; `destination` →
     `destination`; `private`, `customers` → `private`; `delivery` → `delivery`; anything
     else → `yes`, listed in the road's `provenance.inferred`.
   - Mapping: `motor_vehicle`/`motorcar`/`vehicle`/`access` set `all`; `goods` → van;
     `hgv` → truck; `psv`/`bus` → bus. `maxweight` < 3.5 t closes trucks and buses;
     `maxheight` < 3.0 m closes trucks, buses and vans.
   - Lanes: `lanes:psv`, `lanes:bus` and `busway=lane` (with `:forward`/`:backward`/`:left`/
     `:right`) reserve the curb-side lane(s) for buses (`allowed: ['bus']`), and
     `bus:lanes` / `psv:lanes` give the exact pattern when present.
   - `highway=service` with `access=private` stays imported as today; only its rule changes.
   - Report how many Munich and Sindelfingen roads get each rule.
5. **Inspector.** `src/ui/inspector/street.tsx`: an "Access" row with one control for all
   vehicles and an expandable per-class override, using the existing inspector controls.
6. **Simulation.** No change: vehicles follow their routes, and TASK-100 makes lane changes
   respect `Lane.allowed` per class. If a rerouted car finds itself inside a zone it may not
   use (after an edit), it leaves by the shortest legal way, which the existing reroute already
   does once the rule is in the graph.

## In scope

`src/schema/city.ts`, `city.schema.ts`; `src/network/compile.ts`, `src/network/types.ts`
(additive: `CRoad.access`, zones); `src/routing/**` (except the `purpose` line TASK-100 also
adds, which the lead reconciles); `src/importers/osm/roads.ts` (access and bus-lane tags; the
default `allowed` list is TASK-100's one-line change); `src/editor` (the access command);
`src/ui/inspector/street.tsx`; `docs/architecture.md` sections 4, 5, 7 and 13 (describe what
you built); tests (a new `tests/routing/T47-road-access.test.ts`, an importer case in
`tests/importers`, an editor case, an e2e case tagged `@smoke` that sets "local traffic only"
on a street and sees through traffic leave it), and the expectations that move, each named.

## Out of scope

`src/sim` (TASK-100 owns it in this phase), drawing signs or lane text (TASK-107), network
geometry, time-conditional rules (`:conditional`), parking access (TASK-102).

## Gates

1. **Rules hold.** In T47, on the grid fixture: a `no` road is never on a route of the closed
   class; a through trip avoids a `destination` zone even when it is the shortest path; a trip
   that starts or ends in the zone uses it; a `delivery` road admits only delivery requests; a
   bus lane is never a target lane for a car.
2. **Nothing else moves.** With no `access` anywhere and no bus lanes, routes on the grid,
   town, Munich and Sindelfingen equal main's (compare route hashes in T47).
3. **Import.** Munich and Sindelfingen import with the rules; the counts per rule are asserted
   in the importer test within ±10%. Every imported bus lane is the curb-side lane of its
   direction.
4. **Traffic.** Run `npm run traffic:quick` before and after on your branch and report
   completed and gridlocked trips. Munich's imported rules may move trips; report the change
   and the roads behind it. The lead runs the traffic gate at merge.
5. **Editor.** Setting and clearing access is one undo entry each, survives save and open, and
   changes routes after the edit (live edit path, TASK-051).
6. `npm run check`, `npm run test:city` and `npm run test:e2e:smoke` green. Run e2e with
   `CITYFLOWS_TEST_PORT=5302`; never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier) and `npm run traffic:quick`.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick`,
  `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, `npm run bench` or the full `npm run test:e2e`; the lead
  runs them at merge.

## Acceptance

All gates. Open the app (`npm run dev -- --port 5302`), import Munich, set a residential street
to "local traffic only", play, and watch through traffic leave it while local trips still use
it; describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files): the tag mapping as
implemented; rule counts per city; `traffic:quick` before and after; expectations changed, each
with its reason; the final lines of `npm run check`.

Commit on `task/101-road-access`; do not push or merge. The lead reviews only commits.
