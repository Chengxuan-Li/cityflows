# TASK-347 — Junctions drawn as road, one surface per group (drawing only)

Status: started 2026-11-25 in the owner's 6-hour run (batch B; owner's goal for junction nodes: "geometry and
drawing"). Owner: Claude subagent (Opus 5.5). Branch `task/347-junction-drawing`, worktree `D:\cityflows-wt\347`.
Base: main.

## Finding (lead audit, 2026-11-25, main `49bcc780`)

**Degree-two nodes drawn as junctions (B18, drawing half never closed).** Census: Munich 25 of 137, Sindelfingen 25
of 122, Freiburg 58 of 395. These nodes get the minimum setback (half the road width plus 1 m, `junctions.ts:652`), a
fan polygon and kerb bands. Four kinds:

| Kind | Examples |
|---|---|
| a. Signalised crossing between junctions | Munich `n:12`, `n:1204`; Sindelfingen `n:422`, `n:733`; Freiburg `n:1142`, `n:1705`, `n:1701`, `n:1382` (29 in Freiburg) |
| b. One-way to two-way change on a straight road | Munich `n:347`, `n:40`; Freiburg `n:224`, `n:695` |
| c. Corner bending more than 30° | Munich `n:838`, `n:2091`; Sindelfingen `n:1531`; Freiburg `n:104` |
| d. Lane-count change not treated as a continuation | Munich `n:266`, `n:670`; Freiburg `n:744` |

**No single surface per group (J1 drawing).**
- Each group member draws its own outline and kerbs (`compile.ts:478`, `render/layers/nodes.ts:51-77`,
  `render3d/geometry.ts:154-162`). Inner roads are drawn as roads, so members' kerbs face each other inside the group:
  noses at Freiburg `n:1`, `n:970`, `n:2198`.
- The geometry audit measures each member separately.

## Goal

Drawing only, with simulation hashes identical:

1. At degree-two nodes (kinds a to d), draw the road as continuous along the existing movements: a curved strip at
   corners, edge and lane lines continued, no junction fan and no kerb bands. Stop lines and zebras stay where they
   are today.
2. Draw one surface per junction group: the members' outlines plus the inner-road surfaces, with kerbs only on the
   group's outside edge. Build it in the drawing, or as a new compiled field that no simulation code reads.
3. The geometry audit measures each group surface as one junction, and adds a census of degree-two nodes drawn as
   junctions.

## Scope

- `src/render/layers/nodes.ts`, `roads.ts`, `src/render/road-paint.ts`, `marking-geometry.ts`
- `src/render3d/geometry.ts`, `markings.ts`
- `src/network/groups.ts` and `types.ts` (additive field only)
- `bench/geometry-audit.ts`
- render tests

## Out of scope

- `src/importers/**`, `src/sim/**`, `src/schema`
- `lanes.ts`, the `compile.ts` trims, `junctionCuts`, `junctionPolygon`. `CNode.outline` must stay byte-identical;
  crossings, walk, level crossings, heights and stalls read it.
- `crossings.ts`, `walk.ts`, `stops.ts`
- Lane geometry under the drawing: that is TASK-348.
- Acute approaches (J3) and J6.

## Gates

- **Simulation hashes identical:**
  - Munich seeds 1–3 in all four configurations;
  - both full demands;
  - Freiburg gate (hash 1710089250);
  - Sindelfingen.

  Imported cities byte-identical. Only paint and compiled-network hash pins change, each re-pinned with a reason.
- **Audit:**
  - degree-two nodes drawn as junctions: 25 / 25 / 58 down to about 0;
  - no existing audit measure worse beyond the owner-approved tolerance (< 1 cm, < 1 m², one non-sharp corner).
- **Unchanged:** T38, T42, T68, T39.5.
- **Close-ups**, 2D and 3D at the same scale, before and after:
  - Munich `n:838`, `n:12`, `n:347`, `n:266`;
  - Freiburg `n:1142`/`n:1705`, `n:224`, `n:744`, J1-hbf `n:1`/`n:970`, J1-stefan `n:5`;
  - Sindelfingen `n:422`, `n:1531`.
- **Budgets:** T16, T64, York first frame.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Commit body with the census before and after, the audit table, the close-up paths and the hash list.
