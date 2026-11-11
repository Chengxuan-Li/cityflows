# TASK-140 — Crossing walk links and pedestrian heads at the zebra stripes (B59)

Owner: the lead, through a Claude Code subagent (owner's orchestration rule, 2026-11-11)
Gate: 9 (pedestrians), bug B59
Branch: `task/140-crossing-links` (created by the lead from main, after TASK-131 merges)
Depends on: TASK-091 and TASK-094 (crossing stripes and set-back), TASK-110 and TASK-111 (walk
network and pedestrian rules), TASK-131 (junction groups: no crossings on inner links).
Runs alongside:
- **TASK-135** (tram tracks): rail import and drawing.
- **TASK-133** (station furniture): new station modules.

Stay out of their files.
Design: this file; `docs/architecture.md` sections 5.6 (walk network) and 8 (pedestrian rules).
Read B50, B53, the TASK-094 and TASK-111 review entries, and B59 in `docs/plan.md`.

## Goal

B59 (TASK-131 review, 2026-11-11): at signalised crossings, the pedestrian signal heads and the
walk link that walkers use stand 8 to 10 m nearer the junction than the drawn zebra stripes.
- **Extent:** in Munich the link is more than 3 m from its stripes at 100 of 249 signalised
  crossings, 76 of them at junctions outside any group (`n:34` 4 to 6 m, `n:372` 4 m, `n:23`
  5 m).
- **Cause:** TASK-094 set the stripes back behind the stop line (B53), but the walk links and the
  heads stayed at TASK-091's position.

Walkers, the heads and the conflict zone where cars yield to walkers must all be where the
stripes are.

## Design

1. **Trace.** Find where the crossing walk link's position comes from (`src/network/walk.ts`,
   `walk-joins.ts`, `crossings.ts`), and where the heads and the walker conflict zone take theirs.
   List the crossing kinds: signalised, zebra, unmarked; split at a median or not.
2. **One position.** Make the stripes' centreline (`crossingSpan` / TASK-094) the single source.
   - The walk link runs along the stripes' centreline.
   - The pedestrian heads stand at the stripes' ends.
   - The conflict zone (TASK-111) covers the stripes.
3. **Unmarked crossings** keep their position unless the same mismatch applies; say which.
4. **Stop lines** stay where TASK-094 put them: behind the stripes.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file the
feature needs in order to be wired in, type-check or be tested, as long as it is not named under
"Out of scope"; list each such file and why in your report.

Pre-approved:
- `src/network/crossings.ts`, `walk.ts`, `walk-joins.ts`, `conflicts.ts` (the walker conflict
  zones);
- the pedestrian head drawing in `src/render/layers/signals.ts` and `src/render3d/signals.ts`;
- `src/sim/walkers.ts` only if a position is read there instead of from the compile; say so;
- `docs/architecture.md` sections 5.6 and 8;
- `bench/traffic-baseline.json` (the lead re-records it);
- tests: new `tests/network/T71-crossing-links.test.ts`, and the T41, T26 and T53 pins that move,
  each with its reason.

## Out of scope

- Rail import and drawing (TASK-135), station modules (TASK-133).
- `src/demand/**`, `src/sim/parking.ts`, `connectors.ts`, `persons.ts`.
- Signal timing and phases.

## Gates

1. **Rule.** In T71, on synthetic junctions (signalised, zebra, median-split):
   - the walk link lies within 0.3 m of the stripes' centreline;
   - the heads stand at the stripes' ends;
   - the conflict zone covers the stripes;
   - same city, same hash.
2. **The cities.** In Munich and Sindelfingen, every signalised and zebra crossing's walk link is
   within 0.5 m of its stripes. Report the counts against main (main: 100 of 249 Munich signalised
   crossings more than 3 m off).
3. **Traffic.** Munich 0.15 to 10:00:
   - completed, gridlocked and stalled heads against main;
   - walker trips completed and failed;
   - mean walk time;
   - T53 passes at 5%.

   The baseline resets at merge.
4. **Pictures.** 2D shots at 10 px/m of `n:34`, `n:372`, `n:23` and one median-split crossing,
   before and after, with walkers crossing.
5. **Checks.**
   - `npm run check` and `npm run test:city` are green.
   - `npm run test:traffic:light` passes.
   - `npm run test:e2e:light` passes, plus T26, T41, T53 and demo-a-commute, with
     `CITYFLOWS_TEST_PORT=5340` and `CITYFLOWS_PRODUCTION_TEST_PORT=5440`.

## Deliverable

A report in the body of your last commit message:
- the trace;
- the rule;
- the counts against main;
- the shots;
- every changed pin with its reason;
- files outside the pre-approved list;
- the final lines of `npm run check`.

Commit on `task/140-crossing-links`; do not push or merge.
