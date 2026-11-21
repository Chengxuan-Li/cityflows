# TASK-254 — Road widths and `placement` from the data, read by rule (TASK-242's placement and tagged widths)

Status: in progress 2026-11-20 (third unsupervised run). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/254-placement-widths`, worktree `D:\cityflows-wt\254`, ports 5454 / 5554.

## Goal

TASK-242 (parked; branch `task/242-road-widths`, first version `4f10345`, variant `0d98c7a`; review in
`docs/plan.md`) read `placement`, `width:lanes` and `width` and narrowed untagged urban lanes. Its
`placement` and tagged widths alone leave Munich unchanged and put `r:261` within 0.25 m of the imagery;
the untagged-lane narrowing is what moved Munich's full demand. Land `placement` and the tagged widths
(not the untagged narrowing) on current main.

The owner decided on 2026-11-20 that the app's reading of OSM is to be improved to match the ground,
not OSM itself, and not per-id curation. Two cases follow from that:

1. `r:1179`'s `placement=right_of:3` contradicts the imagery (the way's line sits 2.1 m over the gore).
   Find what other OSM evidence (the neighbouring ways' placement and lanes, the split or gore node, the
   way's `turn:lanes`, the connecting carriageways) puts it where the ground has it, and write a general
   rule that reads it so. Say how many ways in each city the rule changes and check a sample against the
   imagery. If no rule can tell, say so with the evidence and leave `r:1179` as tagged.
2. The bulge at `n:1146` (`r:1148`'s `width:lanes`, 31.46 to 34.10 m² in TASK-242's variant) is over the
   audit tolerance. Fix it within the rule, or show from the imagery that the drawn surface matches the
   ground there.

## Scope

`src/importers/osm/roads.ts` (widths), `src/importers/osm/corridors.ts` (placement; TASK-238's median
rule must keep working), tests, the Freiburg rebuild and pins, Munich re-pins, close-ups under
`docs/findings/2026-11-20-placement-widths/` (aerial overlay; imagery read-only in
`D:\cityflows-wt\216-data`; download nothing).

Out of scope: `split.ts`, `src/network/**`, `src/sim/**`, `src/schema`, the audit, gate floors,
`bench/traffic-baseline.json`, OSM edits, per-id curation.

## Gates

- A test per rule that fails without it; roads touched per city; `r:261`, `r:1179`, `n:1146` and
  Rotteckring against the imagery before and after.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes; full
  demand on seeds 1 to 5, both modes (the five-seed reading); Freiburg's gate and seeds 1 to 3;
  Sindelfingen; the Munich gate and mode-share guard (references: the newest figures in `docs/plan.md`).
- The geometry audit on the three cities, within the lead's tolerance (decisions log, 2026-11-20).
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per rule the cause, the rule, the counts; the imagery checks; the audit;
the traffic tables.
