# TASK-144 — Munich parking-lot access

Trace OSM way 159640404 in the bundled Munich extract. Identify both directed roads and their connectors from source provenance. Reproduce legal external approach, parking and return to a public road through the actual route and simulation workflow. Check whether the historical dead-end report describes a real access defect or a stale ID. Repair a demonstrated importer or parking-access fault at its source and cover it with a focused regression if necessary. Preserve real OSM one-way restrictions. Deliver location, road and connector IDs, reproducible trips, outcomes and close 2D/3D geometry shots. Use ports 5344/5444; keep browser work and broad tests out of the frame agent's timed windows.

Audit (2026-11-12): south of Landsberger Straße, near 48.1393 N, 11.5366 E. Way
159640404 is a two-way aisle: `r:2103` runs south-to-north, `r:2104` returns south.
On the parent import, `c:9404` belongs to `r:2103`, `c:9405` to `r:2104`; the historical
`c:9407` belongs to another aisle, way 887299870 / `r:2152`. The whole lot already admits
and returns visitors through its northern entrance, but its actual southern shared OSM
node 1717584268 (`n:2102`) was left disconnected from way 159640408. A second join at
1717561493 (`n:2109`, adjacent lot) was lost when public ways 159638178/159638179 merged.

The repair splits only public, single-lane service roads at retained, same-grade source
vertices, after original public/aisle IDs are allocated. Private spines, complex/controlled
roads and source points removed by smoothing remain unsupported and are diagnosed;
no geometry or reverse direction is invented. The focused corpus/round-trip regression is
`tests/importers/lot-access.city.test.ts`: fixed gateways `p:1458` and `p:1481` visit
`p:1558`, and `p:1481` visits adjacent `p:1560`, departing at 07:00:10 and returning at
07:10:00. Both before and after imports complete all six legs, including parking and dwell.
Legal external routing to the southern `r:2103` entry changes from unreachable to reachable.
