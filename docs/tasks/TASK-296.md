# TASK-296 — A synthetic one-runway airport and airside topology regression tests

Status: planned 2026-11-22 (airports batch, owner's go; starts after TASK-295). Proposed owner: Codex CLI
(gpt-6.2-sol, high). Branch `task/296-synthetic-airport`, worktree `D:\cityflows-wt\296`, ports 5496 / 5596.

## Goal

A generated airport fixture (`src/fixtures/`, seeded like the other fixtures) built to TASK-295's schema, the
regression airport for every later task of the batch (`docs/decisions/2026-11-22-airports.md`): small, exact,
every rule visible.

- One runway 09/27 with a parallel taxiway and four exits (one rapid exit each way), a holding position at every
  runway entry, an apron with six contact stands of two aircraft codes (C and E) and two remote stands, a
  taxilane, one hangar with its apron, one helipad, a terminal, a short landside road with a car park, so the
  city compiles as any other.
- A variant without the parallel taxiway (turning pads at both ends, as London City), where aircraft must
  backtrack on the runway.
- Both listed wherever the other fixtures are offered (scenario list).

Tests on both and on London City: the airside graph is one component; every stand reaches both runway ends;
code limits hold (a code E stand admits codes up to E, a code C taxilane rejects D and up); holding positions sit
on the graph on the protected runway's side; a backtrack path exists in the variant; generated lead-ins are
marked as generated.

## Scope

`src/fixtures`, the scenario list (`src/ui/bundled-projects.ts`), tests; importer or topology fixes the tests
expose (state each).

Out of scope: aircraft and schedules (TASK-298, 299), markings (TASK-297), `src/sim`, gate floors,
`bench/traffic-baseline.json`, any download.

## Gates

- The fixture and its variant compile and open in the app; the tests above pass, and fail on a deliberately
  broken copy (say how).
- Existing archives and state hashes byte-identical.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
