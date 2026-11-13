# TASK-149 — Remaining imported parking-lot access

Classify each of TASK-144's ten Munich and sixteen Sindelfingen candidate joins against source access, grade and direction, compiled topology, legal routes into and out of the lot and actual parking where relevant. Distinguish individual entrances from whole-lot access. Repair demonstrated defects at their source, preserve restrictions and existing IDs, and cover representative regressions. Own importer/access code, focused city tests and the per-site findings in this task. Report any unresolved site with its evidence. Preserve timetable and route compatibility, run check, city and the original traffic gate for traffic changes. Deliver matched 2D and 3D geometry shots clearly locating each parking fix and corresponding source IDs. Use ports 5349/5449, coordinate browser captures with TASK-148 and keep evidence outside tracked build output.

Implementation and source audit (2026-11-12)

These are parking access repairs, with external routing ending at a source-proven mouth and
local driving continuing along its actual directed aisle. They do not split the remaining
through streets. The two TASK-144 public-road splits remain unchanged. `entries` still names
true shared vehicle-graph nodes; optional typed `mappedPortals` names each connector, source
aisle, mouth node and allowed direction. The lead approved this contract addition and its
update in `docs/architecture.md`.

The original importer omitted these shared source mouths when public ways were imported
before parking aisles. Smoothing also replaced some source vertices (largest observed offset
0.191 m). The repair requires the same source node on both ways, equal grade and a retained
street line within one metre; it uses that exact directed street's edge lane facing the
mouth. It does not connect a nearby unrelated street or carriageway. Existing signals,
turn rules, one-way roads and private access zones remain authoritative. Inferred nearest-road
driveways are replaced by proven mapped accesses, reusing their IDs. Independently mapped
aisle connectors survive. The demonstrated detached Landshuter fallback `c:9408` moves from
Arnulfstraße `r:651` to the true northern aisle `r:2074` at `n:661`, position 0, inbound.

Each fitted throat is directional and cannot borrow an adjacent exit. Local source-aisle
edges are directed, with reverse searches for departures; generated circulation stays
bidirectional. A clear bay manoeuvre may reach either lane of the same physical two-way
aisle, but cannot reverse a one-way aisle. The aisle's vehicle permissions apply to route
arrival, parking admission, initial stock and departure. Richelstraße's 2.1 m limit therefore
continues to exclude vans, trucks and buses even though its street permits them.

All rows below are at source grade 0 and have no control tag on the mouth itself. `both`
means lawful entrance and departure at that individual mouth; it is separate from whether
the whole lot already had another entrance or an inferred driveway. Every row has a fitted
inbound/outbound path as permitted by its source direction. Source and compiled IDs, exact
connector lane/stations, directions, route checks and path geometry are in the evidence JSON.

| City / mouth OSM node | Street source / direction | Aisle source | Lot source / canonical ID | Individual mouth |
|---|---|---|---|---|
| Munich 846546795 | 340783842 / two-way | 71076737 / one-way | 54172005 / pk:2047 | exit only |
| Munich 846546796 | 340783842 / two-way | 71076738 / one-way | 54172005 / pk:2047 | entrance only |
| Munich 1461102990 | 132804156 / one-way, 3 lanes | 30816105 / two-way | 106547917 / pk:2049 | both, edge lane 0 |
| Munich 4698232309 | 134171449 / one-way, 2 lanes | 30816105 / two-way | 106547917 / pk:2049 | both, edge lane 0; direct Arnulf approach remains banned |
| Munich 1717584237 | 159640407 / two-way | 159640405 | 159640410 / pk:2052 | both |
| Munich 1717584248 | 159640407 / two-way | 887299870 | 159640410 / pk:2052 | both |
| Munich 8249838034 | 159638178 / two-way | 887299868 | 160401431 / pk:2053 | both |
| Munich 8249838036 | 159638178 / two-way | 887299869 | 160401431 / pk:2053 | both |
| Munich 3883875903 | 134171458 / one-way, 2 lanes | 30816209 | 372315670 / pk:2056 | both, edge lane 0; north shared entry also retained |
| Munich 15993165 | 449747797 / two-way | 449747799 / private | 449747772 / pk:2059 | both; private aisle permission retained |
| Sindelfingen 2955433067 | 220072431 / private, two-way | 292031192 | 292031578 / pk:1476 | both |
| Sindelfingen 2955433074 | 220072431 / private, two-way | 292031193 | 292031578 / pk:1476 | both |
| Sindelfingen 2955433090 | 220072431 / private, two-way | 292031194 | 292031578 / pk:1476 | both |
| Sindelfingen 2955433092 | 220072431 / private, two-way | 292031195 | 292031578 / pk:1476 | both |
| Sindelfingen 2955433080 | 220072431 / private, two-way | 292031196 | 292031578 / pk:1476 | both |
| Sindelfingen 2955433068 | 220072431 / private, two-way | 292031197 | 292031578 / pk:1476 | both |
| Sindelfingen 2955433069 | 220072431 / private, two-way | 292031198 | 292031578 / pk:1476 | both |
| Sindelfingen 2955433079 | 220072431 / private, two-way | 292031201 | 292031578 / pk:1476 | both |
| Sindelfingen 2955433066 | 220072431 / private, two-way | 292031202 | 292031578 / pk:1476 | both |
| Sindelfingen 2955433082 | 220072431 / private, two-way | 292031203 | 292031578 / pk:1476 | both |
| Sindelfingen 353403302 | 31583966 / private, two-way | 1231631263 | 1231631260 / pk:1485 | both |
| Sindelfingen 353403616 | 31583966 / private, two-way | 31583976 / customers | 1231649712 / pk:1487 | both |
| Sindelfingen 353403180 | 31583966 / private, two-way | 31583976 / customers | 1231649712 / pk:1487 | both |
| Sindelfingen 353403162 | 31583966 / private, two-way | 31583981 / customers | 1231649712 / pk:1487 | both |
| Sindelfingen 353403639 | 31583966 / private, two-way | 31583983 / customers | 1231649712 / pk:1487 | both |
| Sindelfingen 11422610549 | 31583984 / customers, two-way | 1231649714 | 1231649715 / pk:1488 | both; three reachable bays, no invented owner place |

Before the repair, every listed mouth lacked a vehicle-graph junction. Whole lots 2052,
2053 and 2056 already had other mapped access; 1476/1485/1487/1488 relied on inferred
driveways. The remaining lots also had inferred or repaired portals, which did not prove
access through these individual mouths. This distinction is captured in `baseline-audit.json`.
The post-repair street graph intentionally remains unsplit at these mouths; the typed local
parking path represents the off-street transition, rather than claiming a new routing edge.

Two layout defects also prevented actual parking: Richelstraße had only mapped entrance
stubs outside its polygon, and overhead bridge surfaces blocked ground-level bays. Interior
rows are now inferred only where mapped stubs provide no interior aisle and the polygon has
clear room; a clear continuation is reserved behind each throat. A known, single aisle grade
filters road/node obstructions to that grade. Ground roads and source building exclusions
still block bays; unknown/mixed grades retain conservative obstruction handling. No bridge
pier geometry is modeled by the current schema. The same grade repair restores the adjacent
under-bridge lot OSM 106547920 / pk:2050, which is included in the geometry evidence.

Independent path audit of the candidate finds usable bays: Munich 2047=86, 2049=17,
2052=74, 2053=75, 2056=6, 2059=8; Sindelfingen 1476=149 of 150 generated bays,
1485=6, 1487=65, 1488=3. The dense lot's one excluded bay remains diagnosed as unreachable;
capacity is never fabricated to make a reachability check pass. The original `r:958` to
`r:663` restriction at `n:647` retains the German source note's banned direct Arnulfstraße
approach; a legal route may reach the mouth by a detour, not by that prohibited movement.

Verification/evidence in progress: focused source/path tests pass all 26 mouths and original
TASK-144 round trips; independent synthetic checks find 0 wrong-way eligible paths and 0
actual wrong-way motion samples, with legal car parking/return and restricted van refusal.
The lead's independent compatibility proof retains all 192 complete historical route results,
all physical road/lane/movement geometry and controls, canonical walking source and the full
train timetable. No raw route fixture or threshold is changed. The unchanged original traffic
gate and the complete check/city runs are required before this task is marked complete.

Evidence directory: `D:/cityflows-task149-evidence`. Matched genuine app captures are
`baseline-` and `current-`, with suffixes `-2d.png` and `-3d.png`, for
`richel-54172005`, `ramps-106547917`, `south-159640410`, `adjacent-160401431`,
`landshuter-372315670`, `private-449747772`, `bridge-106547920`, `spine-292031578`,
`west-1231631260`, `east-1231649712` and `north-1231649715`. Ports are 5349/5449;
captures and local checks were coordinated around TASK-148's reserved measurement windows.

Entry-choice follow-up (lead approved): after selecting a mapped lot in the existing facility
ranking, choose its cheapest eligible street route instead of the first canonical entry.
Reuse the winning route. T63 covers a direct mouth beating a three-road detour, the nearer
public garage retaining lower facility priority, closed-mouth permissions and legacy entry
ordering. Dedicated hosted traffic and full checks remain required before integration.
The follow-up T63 live-edit case cuts a selected throat while retaining the claimed bay's
ordinal; the claim is released and the car completes through another legal mouth.
