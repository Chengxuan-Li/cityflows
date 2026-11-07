# TASK-091 — Pedestrian crossings everywhere and editable; centre lines end at the junction (B50, B46, B52)

Owner: unassigned
Gate: 5 (owner findings round 5)
Depends on: TASK-072 (crossings on the road at its stop position), TASK-074, TASK-089.
Design: `docs/plan.md` backlog B46, B50, B52 and the screenshots in
`docs/findings/2026-11-06-round5/` (2, 6, 7); `docs/architecture.md` sections 5.1, 11 and
the TASK-072 crossing paragraph. Read those before the code.

## Goal

The owner (round 5):

- **Crossings (B50).**
  - Every junction gets pedestrian crossings by default, except at expressway ramps.
  - Crossings are editable. They are purely decorative for now.
  - Crossings start farther from the junction. At `n:291` (7) the stripes run into the curb
    corner.
- **Centre lines (B46).** A two-way road's centre line runs into the junction at
  Westendstraße/Ganghoferstraße (2) and on the south road at `n:104` (6, the X). It must end
  at the junction mouth.

Today `roads.ts` (`laneMarks`) draws crossings only at signalised nodes:
`crossingEnd: controlled && node.signal !== null`.

## Design

1. **Default rule.** A road end at a node of three or more arms, or at a signalised node, gets
   a crossing unless any of these holds:
   - the road is a motorway, a `*_link` of motorway or trunk class, or a slip lane (whatever
     `roadClass` calls those);
   - the node is a motorway merge or diverge (every arm is motorway or link);
   - the end lies inside a roundabout ring.

   Ends at nodes of one or two arms get none.
2. **Editable, stored as overrides.** The default is derived. Add an optional per-road-end
   override: for example `Road.crossings?: { start?: boolean; end?: boolean }`, or a node-level
   map; choose the simpler. Only explicit edits are stored. Old project files load unchanged
   with the defaults, and a file saved with overrides round-trips. The owner has approved
   schema and project-format changes; bump the format version if the schema requires it, and
   keep loading old files.
3. **Editor.** Selecting a node lists its arms in the node inspector (`src/ui/inspector/node.tsx`),
   each with a "Crossing" checkbox showing the effective state. Changing one is an undoable
   edit, like the other inspector edits. No simulation effect: benchmark hashes and the
   simulation are unchanged.
4. **Set-back.** A crossing's near edge starts where the curb return meets the road's edge,
   plus 1 m, and never inside the junction polygon or a curb arc. Keep TASK-089's rule of
   moving out along the road to clear the outline, and its stripe-count gate. If the road is
   too short (closer than 10 m), draw no crossing; then the inspector shows the box disabled,
   with a reason.
5. **Centre lines (B46).** Clip centre lines at each end's cut or stop position, as TASK-074
   does for lane dividers, so no centre-line segment lies inside a junction polygon. Check
   this at every Munich and Sindelfingen node.

## In scope

`src/schema` (the override field, format version), `src/render/layers/roads.ts` and
`junction-markings.ts` (crossing rule, set-back, centre-line clip), `src/ui/inspector/node.tsx`
and the edit command it calls, the project load/save code that needs it, `tests/render`
(T41, new), `tests/e2e` (one new spec, tagged `@smoke` if TASK-090 has landed),
`docs/architecture.md` (the crossing paragraph and the schema table), and render
expectations that move (T32 and T28 stripe counts, each named).

## Out of scope

`src/network` geometry, `src/importers`, `src/sim`. Test tiers belong to TASK-090, which is
in parallel; do not restructure tests.

## T41 and the gates

1. **Defaults.**
   - On Munich, Sindelfingen and town: every road end at a junction of three or more arms
     that is not excluded has a crossing.
   - No crossing on motorway or link roads or at motorway merges.
   - List the counts before and after per city.
2. **Set-back.** No stripe lies inside a junction polygon or a curb arc, or within 1 m of the
   curb return, on all four cities. `n:291`'s west arm is clear of the corner (shot).
3. **Overrides.** Toggling a crossing redraws it. The edit undoes and redoes, and the project
   saves and reopens with the override. A file from main loads with the defaults.
4. **Centre lines.** No centre-line segment lies inside any junction polygon (0.1 m tolerance)
   on all four cities. Westendstraße/Ganghoferstraße and `n:104` south show this in shots.
5. Benchmark hashes unchanged; `npm run check` green; e2e (`--grep-invert T16`) green on
   port 5288.

## Acceptance

T41 passes. Give `npm run geometry-shots` before and after (R3-1-n1181, B41-n104, B41-n949,
and new cameras for `n:291` and Westendstraße/Ganghoferstraße). The new e2e test toggles a
crossing in the inspector and checks the drawing.

## Deliverable

A report in the body of your last commit message (no new Markdown files):

- what works and what is not supported;
- the default rule as implemented;
- the schema change;
- T41 results;
- changed expectations;
- image paths;
- the final lines of `npm run check`.

Commit in your git worktree; the lead reviews only commits.
