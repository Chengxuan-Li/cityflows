# TASK-231 — One carriageway for close halves and shared one-lane streets (TASK-218's D5 and D6 alone)

Status: in progress (unsupervised run, owner 2026-11-19; split from parked TASK-218). Proposed owner:
Claude Code subagent (Opus 5.5, high). Branch `task/231-halves-shared-lanes`, worktree
`D:\cityflows-wt\231`, ports 5431 / 5531.

## Goal

TASK-218 (parked; branch `task/218-importer-roads`, `26f69c5`; review in `docs/plan.md`) bundled
widths, medians, shared lanes and stop positions; its widths moved Munich's traffic and its stop-line
groups and widths made the audit worse. Its D5 and D6 rules touch only Freiburg and Sindelfingen's
shared lanes and none of the width or group rules. Land them alone:

1. **D5.** Opposite carriageways of one street whose lane blocks, on their OSM lines, leave a gap under
   2 m over at least 20 m (RASt 06's narrowest median strip; motorways, trunks and ramps excluded)
   are pulled to a 0.5 m painted median, eased at the ends so no node moves (`corridors.ts`):
   Bismarckallee `r:1251`/`r:2215` as one surface.
2. **D6.** A two-way way with `lanes=1` is one 4.5 m carriageway, half per direction, marked
   `sharedLane` in its provenance (`roads.ts`), and no centre line is drawn between the two halves
   (`marking-geometry.ts`, which TASK-218 could not touch).

Take the rules from TASK-218's commit, not its width, `width:lanes` or stop-position rules.

## Scope

`src/importers/osm/corridors.ts`, `src/importers/osm/roads.ts` (the shared-lane rule only),
`src/render/marking-geometry.ts` (the centre line), the Freiburg rebuild and its pins, tests,
close-ups under `docs/findings/2026-11-19-halves-shared-lanes/` (aerial overlay, imagery read-only in
`D:\cityflows-wt\216-data`; download nothing).

Out of scope: `src/importers/osm/split.ts` (TASK-226 parked there), `src/network/**`, `src/sim/**`,
`src/schema`, gate floors, `bench/traffic-baseline.json`.

## Gates

- A test per rule that fails without it; counts of roads touched per city.
- The geometry audit (`bench/geometry-audit.ts`) on the three cities: no measure worse.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes, or
  identical hashes if Munich's city does not move (TASK-218 counted 10 Munich shared lanes, so it
  likely moves); full demand both modes (references actuated 3,759 / 143, hash 4028429784; fixed
  3,501 / 168, hash 2888500527); Freiburg's gate (4038635547) and seeds 1 to 3; Sindelfingen; the
  Munich gate and mode-share guard.
- The owner's merge rule (plan, owner decisions log, 2026-11-19). If the first version misses, try one
  variant (say what it drops) and report both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per rule the cause, the rule, the counts; the audit; the traffic tables.
