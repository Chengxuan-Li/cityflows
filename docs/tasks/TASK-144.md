# TASK-144 — Munich parking-lot access

Trace OSM way 159640404 in the bundled Munich extract. Identify both directed roads and their connectors from source provenance. Reproduce legal external approach, parking and return to a public road through the actual route and simulation workflow. Check whether the historical dead-end report describes a real access defect or a stale ID. Repair a demonstrated importer or parking-access fault at its source and cover it with a focused regression if necessary. Preserve real OSM one-way restrictions. Deliver location, road and connector IDs, reproducible trips, outcomes and close 2D/3D geometry shots. Use ports 5344/5444; keep browser work and broad tests out of the frame agent's timed windows.

Audit (2026-11-12): south of Landsberger Straße, near 48.1393 N, 11.5366 E. Way
159640404 is a two-way aisle: `r:2103` runs south-to-north, `r:2104` returns south.
On the parent import, `c:9404` belongs to `r:2103`, `c:9405` to `r:2104`; the historical
`c:9407` belongs to another aisle, way 887299870 / `r:2152`. The whole lot already admits
and returns visitors through its northern entrance, but its actual southern shared OSM
node 1717584268 (`n:2102`) was left disconnected from way 159640408. A second join at
1717561493 (`n:2109`, adjacent lot) was lost when public ways 159638178/159638179 merged.
The final southern portal is `c:10831` on `r:2103`; original `c:9404` and `c:9405` survive.

The repair splits only public, single-lane service roads at retained, same-grade source
vertices, after all original road, place, parking, walk, rail and tram IDs are allocated.
Private spines, complex/controlled
roads and source points removed by smoothing remain unsupported and are diagnosed;
no geometry or reverse direction is invented. The focused corpus/round-trip regression is
`tests/importers/lot-access.city.test.ts`: fixed gateways `p:1458` and `p:1481` visit
`p:1558`, and `p:1481` visits adjacent `p:1560`, departing at 07:00:10 and returning at
07:10:00. Both before and after imports complete all six legs, including parking and dwell.
Legal external routing to the southern `r:2103` entry changes from unreachable to reachable.

The observed imported corpus has 12 lost/shared-source joins in Munich: the two repaired
sites above and ten diagnosed group, road-class or smoothed-vertex cases. Sindelfingen has
16 diagnosed cases and no changed vehicle geometry. Contracting the two repaired joins
restores every original public road and node byte-for-byte. Original walk/rail source data
and the complete train timetable remain equal to parent. Target/adjacent capacity changes from
73/78 to 74/75 spaces because real junction clearance now applies.

Compatibility proof compares the final import with exact clean parent
`fa8c621ec4075d54eef52071c5aaf62cf5f2acbf`. All 882/926 original roads and 1086/1051 lanes
in Munich/Sindelfingen retain their dense indices; 7232 road-noise factors across four seeds
are identical. ZIP and JSON save/open retain compiled road/lane order. New public halves are
explicitly marked and appended by the compiler, preserving ordinary maps' existing ID order.
The original historical 96-route fixture and its unchanged nine-change ceiling are retained:
the final candidate has the same five differing records as parent, with no newly changed
request. Both fail the same three requests. Complete timetable JSON is identical, hash
`0d505d0f`. Evidence scripts and JSON are in `D:/cityflows-task144-evidence`:
`late-probe.mjs` and `late-compatibility.mjs`, run from this worktree with Node's type stripping
and `--import ./bench/register.ts` (the persistence probe also imports `json-hook.mjs` to load
the bundler's package-version export).

Verified final source: `npm run check` passes 192 files and 1160 tests (one skipped); strict
city shards pass all 46 files and 164 tests (one skipped), Actions run `43321592437`.
Run `43320639940` passes the unchanged traffic-light gate (3964 completed, 32 gridlocked),
T53 and original T70 browser departure rows. Its only city failure was a whole-City allocator
pin, independently corrected and covered by the subsequent strict city run. No threshold or
historic route fixture changes. Matched actual-geometry captures are `baseline-*` and
`final-*` in the evidence directory: `lot-close-2d.png`, `lot-close-3d.png`,
`south-junction-2d.png`, and `locator-2d.png`.
