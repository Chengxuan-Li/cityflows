# TASK-207 — Freiburg's validation warnings

Status: done 2026-11-19 (curation merged; F1 and F2 held for the owner). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/207-freiburg-warnings`, worktree `D:\cityflows-wt\207`, ports 5407 / 5507.

## Goal

The landing city opens with "Validation 187" in the sidebar. Sort the 187 diagnostics by code and
cause into:

1. importer or compile bugs (a real road, lane, turn or place handled wrongly): fix them in general
   code, not for Freiburg alone;
2. things to curate in Freiburg (`curateFreiburg` in `bench/freiburg.ts`, keyed to OSM ids as the
   existing edits are), when the OSM data is wrong or the polygon cut leaves an artefact;
3. true but harmless notices that a user cannot act on: say which, and whether such a notice should
   be shown at the info level at all (propose; do not change severity rules without listing them).

Report the counts per code before and after, and per group. Junction shapes, lane splits and merges,
and markings are TASK-212 to 215's subject: if a diagnostic belongs there, list it for them instead
of fixing it.

## Scope

`src/importers/**`, `src/network/diagnostics.ts` and the compile checks that raise these codes,
`bench/freiburg.ts`, `fixtures/projects/freiburg.cityflows.json` (rebuilt by the script), tests.

Out of scope: `src/schema`, the simulation, junction geometry (`junctions.ts`, `corridor.ts`), lane
splits and merges (`lanes.ts`, `lane-drop.ts`), markings, gate floors, `bench/traffic-baseline.json`.
If a fix moves Munich or Sindelfingen compile pins, list what moved and why before re-pinning.

## Gates

- A test per general fix that fails without it.
- Freiburg's gate passes (re-pin its hashes with the reason); Munich gate and mode-share guard
  unchanged unless a listed fix moves them.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
- A screenshot of the Validation panel before and after.

## Report

Write it as the commit body: the table of codes, the groups, each fix, and what remains and why.
