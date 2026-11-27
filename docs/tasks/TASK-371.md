# TASK-371 — Inner roads without stub lane blocks, third try: traffic unchanged by construction

Status: started 2026-11-27 (owner: "start both"; city work merges under the traffic merge rule and the audit
tolerance). Owner: Claude subagent (Opus 5.5). Base: main `5f172cb6`.

## Finding (TASK-348 rule 1, TASK-368)

Inner roads of junction groups keep stub lane blocks under the 5 m trim floor: 69 / 30 / 121 in Munich, Sindelfingen
and Freiburg. TASK-368 removed them (census to 0; J1-hbf overlap 31.12 → 6 m²) in two versions. Both moved the covered
lane slices into the adjacent movements. Both changed the conflict partners of 165 movements, and both failed:
- Munich actuated delay +4.7% / +9.9%;
- Freiburg 62 → 76 s;
- London City worst visit 802 → 1,111 s or more;
- J1-stefan overlap stayed at 25.96 m², and Sindelfingen gained a sharp corner.

Read TASK-368's Result (branch `task/368-inner-floor`, `60dcd7d3`) and TASK-348.

## Goal

Remove the stubs without changing traffic. The simplest form to try first is **drawing and geometry only**: the
compiled lane graph keeps its lengths, movements and conflict zones, and the stub is drawn as part of the group's
surface (TASK-347) instead of as a lane block. This follows the owner's decision 2 for TASK-348, corners
drawing-only. If the audit or the census reads the compiled lanes, so that drawing-only cannot move them, say so
with evidence. Then design the smallest change to the compiled geometry that keeps every movement's conflict
partners and offsets, and test that they are unchanged.

## Scope

`src/network/compile.ts`, `lanes.ts`, `junctions.ts`, `continuity.ts`; the drawing of group surfaces (`src/render`
group-surface and lane-block code, if that is where the stub is drawn); tests; bundled-city rebuilds
(`bench/bundled-cities.ts`, all of them, including York and Zurich) and re-pins.

Out of scope: `src/sim/**`, `src/schema`, signal programs, group membership (`split.ts`),
`bench/geometry-audit.ts` (unless it must read the drawn surface instead of compiled lanes; then stop and report),
`bench/traffic-baseline.json`, OSM edits, per-id curation.

## Gates

- Census 69 / 30 / 121 → 0, by whichever measure the audit uses (state it).
- J1 overlap about 0; sharp corners not worse; geometry audit against main within the audit tolerance.
- Traffic: if the compiled network hash is unchanged, traffic is identical by construction (check one hash per city).
  Otherwise, the owner's full merge rule:
  - Munich 0.15 seeds 1–12, four configurations, within 3%;
  - full demand within 2% on seeds 1–5, both modes;
  - Freiburg within 5 s; drain;
  - Sindelfingen; showcases.
- Close-ups of J1-hbf, J1-stefan and one Freiburg group before and after (PNG).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
