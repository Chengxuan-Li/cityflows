# TASK-089 — Through alignments that reach, a constant median, clean curb ends (B43, B42)

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

## In scope

- `src/network/junctions.ts`, `movements.ts` (through paths), `src/render/layers/nodes.ts`,
  `tests/network` (T38 extended), expectations that move, each named.

## Out of scope

- `src/importers` (TASK-087), `src/render/layers/roads.ts` and markings (TASK-088), `src/sim`.

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
