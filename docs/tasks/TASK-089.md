# TASK-089 — Converging carriageways side by side, through alignments that reach, a constant median, clean curb ends (B41, B43, B42)

Owner: unassigned
Gate: 5 (geometry rework follow-up)
Depends on: TASK-083, TASK-087. Design: `docs/plan.md` backlog B42, B43 and the TASK-083
review; `docs/architecture.md` section 5.1 (TASK-082, TASK-083). Read those before the code.

## Goal

TASK-083 keeps a through road on its alignment only where the joined alignment passes within
2 m of the node: 16 of 127 Munich through pairs and 14 of 114 in Sindelfingen keep their
centerline (`n:30` throughNear 6.06 m, the `n:823` Y far 2.48 m). Divided pairs continuing
into two carriageways widen their median near the node (`r:1280`/`r:1334` 0.5 to 0.93 m). Two
curb ends on the south road at `n:138` show 1 px nubs (R3-6).

## Design

- Through alignments: allow the joined alignment to pass farther from the node where the side
  roads' cuts move with it without costing any approach more than 2 m of storage against main;
  else keep the centerline and name the pair.
- A divided pair (one `corridorId`, two carriageways) crossing a node keeps its median: both
  carriageways' alignments are offset from one shared corridor alignment.
- Curb ends: find and remove the `n:138` nubs (`drawNode`, `nodes.ts`).

## Amendment (lead, after TASK-087): carriageways that meet at one node only

TASK-087 separated the carriageway pairs that meet at both of their nodes. The rest still
overlap near the node where they converge, because a road has one `lateralOffsetM` along its
whole length and its centerline ends exactly at its nodes: an offset that puts the pair side
by side at the shared node moves their lanes 3.75 to 5.5 m at the far node. Cases (T39 names
them): `n:104` (`r:644`/`r:964`), `n:774` west arm (`r:1276`/`r:1368`, and `r:1277`/`r:1362`
held back because the straight continuation would jog), `n:949` (`r:636`/`r:950`,
`r:712`/`r:955`), `n:823` (`r:1372`/`r:845`), `n:1181` west (`r:981`/`r:1358`) and east
(`r:476` against `r:729`/`r:984`, whose exit zebra now shows 4 of 8 stripes), `n:382`
(`r:1354`/`r:447`), Sindelfingen `r:574`/`r:971`.

- In `src/network` (lanes, corridor reference lines), give the converging carriageways of one
  corridor end offsets at the shared node so their lane blocks meet it side by side with the
  0.5 m median, eased back to the road's own offset over the TASK-080 taper length (as
  TASK-071 does for continuation branches). No schema change is needed; if one turns out to be
  (a per-end offset), make it: the owner has approved schema and project-format changes.
- Where the through continuation across the node would jog, ease it with TASK-083's through
  alignment so the through lanes stay within 0.1 m of their line.
- The importer may then push the road bodies apart for these pairs as TASK-087 does
  (`src/importers/osm/corridors.ts`, in scope for that).
- Gates added: measure 9 (lane overlap outside node outlines) for same-corridor pairs zero on
  the four cities except `r:259`/`r:694` (named); no two lanes cross within 40 m of `n:104`,
  `n:774`, `n:949`, `n:823`, `n:1181`, `n:382`; every crossing stripe at `n:1181` on its own
  road (`r:476` all 8); G2 holds (through within 0.1 m, bulge 0); entries removed from
  `tests/network/junction-audit.ts` and T39's named list.

## In scope

- `src/network/junctions.ts`, `movements.ts` (through paths), `lanes.ts`, `corridor.ts`,
  `continuity.ts`, `types.ts`, `compile.ts`, `src/render/layers/nodes.ts`,
  `src/importers/osm/corridors.ts` (the amendment), `bench/geometry-shots.ts` (cameras),
  `tests/network` (T38 extended), `tests/importers/T39*`, expectations that move, each named.

## Out of scope

- `src/render/layers/roads.ts` and markings (TASK-088, merged), `src/sim`.

## Gates

1. Through pairs keeping their centerline: at most a quarter of main's count, each remaining
   one named; audit through far/near no worse anywhere by more than 0.1 m.
2. Every divided pair crossing a node: median within 0.05 m of its value 40 m out.
3. `n:138`: no nub (T38.3's 20 degree vertex rule applied to curb ends).
4. T38.4 storage against main; the plan's traffic gate (at least 3 497 completed and 90 percent
   of main, gridlocked at most 1.5 times main, stalledHeads 0); benchmarks; route audit zero.

## Acceptance

- T38 passes; audit before and after; `npm run geometry-shots` before and after; `npm run
  check` green; e2e (`--grep-invert T16`) green on a port of your own.

## Deliverable

A report in the body of your last commit message (no new Markdown files), as TASK-083's.
Commit in your git worktree; the lead reviews only commits.
