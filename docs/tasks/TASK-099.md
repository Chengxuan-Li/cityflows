# TASK-099 — One lateral shift profile per corridor stretch (B54, B55 redesign)

Owner: unassigned
Gate: 5 (owner findings round 6)
Branch: `task/099-corridor-profile` (created by the lead from main)
Depends on: TASK-089 (split converging ends), TASK-092 (corners, noses), TASK-093, TASK-094,
TASK-095's salvage (on main), TASK-090 (tiers). Design: this file; `docs/plan.md` backlog B54,
B55, the review of TASK-095 in the review log, and `docs/findings/2026-11-07-round6/`;
`docs/architecture.md` section 5.1 (TASK-083, TASK-089, TASK-092, TASK-093). Read those before
the code.

## Why this task exists

TASK-095 tried to attach one street's carriageways (B54) and to hold different roads that
approach a node nearly parallel side by side (B55). It added a second lateral profile, a
"pull", next to TASK-089's split profiles (`CRoad.startShift`, `CRoad.endShift`). After two
rounds it failed:

- Where the split's ease-out meets the pull's ease-in, edges wobble (T39.5: 71 edges against
  a budget of 26). Gaps reopen (`n:638` between the stop line and `n:652`, `n:104` west), and
  dividers break or step (`n:967` east, about 60 m out).
- Two jam heads stalled on `r:961` at `n:967` (the traffic gate needs 0).

Its own conclusion, which the lead shares: two profiles whose eases meet cannot be tuned into
one smooth edge. They must be one signed profile per road, computed once for the whole
stretch of side-by-side carriageways and the node groups at both its ends.

The part of TASK-095 that worked is on main (the salvage). The importer closes gaps under
`ATTACH_GAP_M` = 15 m between one street's carriageways running between the same two nodes, so
Landsberger `n:721`–`n:328` is attached end to end. The geometry audit gained measure 9 per
road-end pair (overlap within 40 m of a node, ends within 20 degrees) and measure 11 (corridor
voids). Everything else is still open.

Reference material, not to merge: branch `task/095-side-by-side`, commits `01b96b1` and
`9e2afcb`. Their bodies list every failure with numbers. Reuse ideas and code from there where
they fit:

- the touching-edge divider marking in `src/render/layers/roads.ts` (`CRoad.beside`);
- the smoothing step that never drops below its target (it fixed T35.1's lane fold on
  `r:186`/`r:187`);
- skipping `r:259`/`r:694`, which meet at no node and overlap in the source;
- the one-lane-width cap for B55 shifts, with `n:68` named.

Do not reuse its two-profile structure.

## Goal

The owner's round 6 sketches, unchanged from TASK-095:

- **B54.** At `n:138` west (`r:386`/`r:716`) and east (`r:715`/`r:958`) and at `n:638` (`r:654`
  / `r:680`), Arnulfstraße's carriageways run attached at the 0.5 m median with a divider line
  from the node to where they really part. "Merge both segments into paired road with center
  divider marker lines."
- **B55.** Different roads that approach a node within 20 degrees and overlap near it are held
  side by side up to the node, with a rounded gore where they part and a solid edge line
  between them (Sindelfingen `n:841`, `n:68`; `n:68` may stay a named exception under the
  one-lane cap).
- **No regressions** of what the split rule already does well: `n:104`'s split ends (the
  owner's TASK-089 sketch), `n:967`'s gore (TASK-093), and `n:774`'s noses.

## Design

1. **One profile per road.**
   - Replace `CRoad.startShift` and `CRoad.endShift` with one signed profile `CRoad.shift`
     sampled every `SHIFT_STEP_M` along the road's reference (empty when the road never
     shifts).
   - `shiftAt(road, s, total)` reads it.
   - Delete the old arrays and every reader's two-ended logic (`compile.ts`, `continuity.ts`,
     `junctions.ts`, `lanes.ts`, `types.ts`, `bench/geometry-audit.ts`). Old code goes when it
     is replaced.
2. **Stretches.**
   - A stretch is a maximal run of two carriageways side by side: same corridor, facing edges
     within 20 degrees and under `ATTACH_GAP_M` apart, no node or other road between them. It
     may span several roads on each side and include TASK-089 split ends at its nodes.
   - B55 pairs (different roads at one node, within 20 degrees, surfaces overlapping within
     40 m or closer than the median) form stretches of their own, from the node to where their
     lines part.
3. **Solve once per stretch.** For each stretch, compute the two sides' profiles together:
   - Target per station:
     - attached (facing edges at the 0.5 m median) where the source lines are within the gap
       limit and within 20 degrees;
     - at a split node, TASK-089's side-by-side ends;
     - elsewhere, the source line (zero shift).
   - Share the offset between the two sides as TASK-083/TASK-089 do (by width, or all on one
     side where the other is a through road).
   - One easing per transition: smoothstep over the TASK-080 taper, then the
     never-below-target smoothing. No profile is the sum of two eases.
   - Lane-count joints: a transition never starts or ends inside a joint's window. The profile
     is constant across it, at its attached value, so `n:638`'s 3-to-5-lane joint near `n:652`
     stays attached.
   - Hard limits checked per station:
     - no lane edge turns back (T33.2, T35.1);
     - the heading change of any lane edge stays within T39.5's wobble rule;
     - no surface crosses another road's.
     If a stretch cannot meet them, leave that stretch as on main and name it.
4. **Markings.** A solid double line between opposite directions, a solid single line between
   the same direction, on touching edges only (TASK-089's touching-edge rule plus round 1's
   `beside`). Dividers end 0.5 m behind a crossing or the stop line (TASK-091); nothing pokes
   into a junction (round 1's `n:104` stub, `n:138`'s '^').
5. **Network.**
   - Movements, ids, places and connectors stay as imported; connector positions along their
     lanes may move (report the largest move).
   - Stop and crossing rules stay as TASK-094 left them.
6. **Audit.** Keep measures 9 and 11 as on main and give before and after per city.
   - Zero corridor voids under the gap limit and zero end overlap within 40 m at small angles,
     except named pairs with a reason each.
   - Main's figures: Munich voids 5 295 m² over 25 pairs, Sindelfingen 1 145 m² over 5.

## In scope

`src/network/continuity.ts`, `corridor.ts`, `lanes.ts`, `compile.ts`, `types.ts`,
`junctions.ts`, `src/render/layers/roads.ts` and `nodes.ts` (divider and edge markings),
`src/importers/osm/corridors.ts` (only if a stretch needs the importer's side; keep the
salvaged 15 m rule), `bench/geometry-audit.ts`, `bench/geometry-shots.ts` (cameras),
`tests/network`, `tests/importers` (T39 extended or a new T45), `docs/architecture.md` section
5.1 (replace the TASK-089 and TASK-093 shift paragraphs with the new rule), and the
expectations that move, each named.

## Out of scope

`src/sim`, the stop and crossing placement rules (TASK-094), the schema, the render layers of
TASK-096 to TASK-098 (`context.ts`, `shadows.ts`, `src/render3d`).

## Checks to run

- While iterating: `npm test` (unit tier, about 15 s), `npm run test:city` (about 20 s),
  `npm run traffic:quick` (about 25 s), and `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city`, `npm run test:traffic` (this task
  moves lanes, so the traffic gate is yours) and `npm run test:e2e:smoke`.
- Do not run the full `npm run test:e2e` or `npm run bench`; the lead runs them at merge.

## Gates

1. **Owner nodes (shots).** Before (main) and after for `R6-n138`, `R6-n638`,
   `R6-sindelfingen-n841`, `R6-sindelfingen-n68`, `B41-n104`, `T93-n967`, `T93-n721-n328`,
   `G2-n774`. Read every image yourself, zoomed in on dividers, gores and every place a
   profile changes:
   - `n:138` both sides and `n:638`: no void from the node to where the carriageways part, one
     unbroken divider, no jog at `n:652`.
   - `n:104`, `n:967`, `n:774`: at least as clean as main (no step, no stub, no lens).
   - `n:841`: side by side, rounded gore, no overlap of the junction outline.
   - `n:68`: as main or better; if named, say why.
2. **Every city.**
   - Corridor voids and small-angle end overlaps as in Design 6.
   - List the stretches changed per city.
3. **No regressions, no budget raised.**
   - T39.5 wobble, T33.2 and T35.x lane folds, T38.x side streets, T42.x corners and noses,
     T32.3 marking offsets.
   - T39.4 may move only with the pairs and figures named in the test.
4. **Traffic.** `npm run test:traffic` passes against `bench/traffic-baseline.json`, with 0
   stalled heads and every failure gridlocked.
5. `npm run check`, `npm run test:city`, `npm run test:e2e:smoke` green. Run e2e with
   `CITYFLOWS_TEST_PORT=5297`; never use port 4173.

If a gate still fails after two honest rounds, stop and report it with numbers; do not raise
budgets.

## Acceptance

All gates. Open the app (`npm run dev -- --port 5297`), load Munich, look at `n:138`, `n:638`,
`n:104` and `n:967` with the simulation running, and describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files):

- the profile rule and constants as implemented;
- stretches changed per city;
- measures before and after;
- named exceptions;
- traffic numbers;
- image paths;
- the final lines of `npm run check`.

Commit on `task/099-corridor-profile`; do not push or merge. The lead reviews only commits.
