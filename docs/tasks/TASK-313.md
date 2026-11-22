# TASK-313 — London City: a taxiway section that reads and behaves as one-way

Status: in progress 2026-11-22 (owner, testing London City). Proposed owner: Codex CLI (gpt-6.2-sol, high). Branch
`task/313-lcy-taxiway`, worktree `D:\cityflows-wt\313`, ports 5513 / 5613.

## Goal

The owner circled a taxiway section on London City's south parallel taxiway between two runway links (screenshot
`D:\cityflows-wt\lead-evidence\owner-lcy-oneway.png`: night 3D, the two links with stop bars, an intermediate holding
light in the section) and reports it is "wrongly labeled as one-way": "even if it were an OSM issue, let's fix it
here". The extract carries no `oneway` tag on any London City taxiway and the archive has no oneway edge, so find what
makes it one-way in appearance or behaviour: a missing straight graph edge or centreline where only a curved link
exists, a junction that admits only one turn direction (turn radius or code), TASK-300's against-flow cost, TASK-298's
route locks, or the markings. Fix it by a general rule in the reading of OSM or in the airside model (never an OSM
edit, never per-id curation), and check every other airport for the same pattern.

## Scope

`src/importers/osm/airport.ts`, `src/network/airside*.ts`, `src/routing/airside.ts`, `src/render/airside-markings.ts`,
London City's archive rebuild, tests.

Out of scope: performance (TASK-310, 311), throughput (TASK-312), schema, gate floors, `bench/traffic-baseline.json`,
any download.

## Gates

- A test that fails without the change: the section is traversable both ways (or the junction admits both turns) as
  the paving shows.
- London City: the circled section before and after (screenshot at the same camera), its full-day gate kept
  (completion, delays, zero go-arounds, overlaps, conflicts); counts of the same pattern at the synthetic airports,
  Zurich, Boston and Heathrow extracts.
- Existing cities unchanged per the rule bullet.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
