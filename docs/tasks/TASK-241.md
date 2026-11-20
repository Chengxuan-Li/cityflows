# TASK-241 — Paint fixes: gores between one carriageway's lanes, arrows over keep-clear boxes

Status: in progress (second unsupervised run, owner 2026-11-20). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/241-gores-keepclear`, worktree `D:\cityflows-wt\241`, ports 5441 / 5541.

## Goal

1. **Gores on a plain carriageway.** TASK-240's overlay (`docs/findings/2026-11-20-r1148-arrows/`,
   both before and after) shows three hatched gore fans (TASK-108's diverge gores) at the upstream end
   of the Hauptbahnhof approach `r:1148`, between lanes of one carriageway, where the imagery shows
   plain lanes; they appear in TASK-224's strips too. Find why (the lanes' split at the upstream node,
   the transition the network builds there, the gore rule's trigger) and paint a gore only where the
   ground has one: between lanes that diverge onto separate roads with a physical or painted island,
   not where lanes of one road widen or fan at a plain node. Census the gores per city before and
   after, and check a sample against the Freiburg imagery.
2. **Arrows over keep-clear boxes.** Arrows paint over the keep-clear boxes at car-park mouths on
   Freiburg `r:904` (0.75 m²), `r:296` (0.29 m²), `r:391`, `r:1333`, `r:1362`, `r:1659`. Keep arrows
   clear of keep-clear boxes the way TASK-217's M4 keeps them clear of crossings (move the arrow along
   its lane, or drop it if no room).

## Scope

`src/render/marking-geometry.ts`, `src/network/transitions.ts` only if the gore's trigger is computed
there, tests, paint pins, close-ups under `docs/findings/2026-11-20-gores-keepclear/` (aerial overlay;
imagery read-only in `D:\cityflows-wt\216-data`; download nothing).

Out of scope: crossing paint and walk links (TASK-239), the importer, `src/sim`, `src/schema`, gate
floors.

## Gates

- A test per rule that fails without it; gore and arrow counts per city before and after.
- Close-ups over the imagery before and after.
- The audit on the three cities: no worsening beyond the lead's tolerance.
- Paint only: identical state hashes (re-measure main's Munich seed-1 hashes first; Freiburg's gate,
  Sindelfingen, both full demands).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per case the cause, the rule, the counts, the hashes.
