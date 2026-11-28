# TASK-385 — TASK-254 to main: the audit reads mapped medians; the B 31 on-ramp bulge

Status: merged 2026-11-28 (`b3ae4dc8`, TASK-254 branch with main): Sindelfingen counted voids 1,334.55 to 1,266.19 m² plus 808.19 m² mapped median; B 31 bulge 0; Freiburg 59.6 to 60.6 s, bulge +0.57 m² at `n:607`; Munich inputs identical; every showcase passes.
`task/254-placement-widths` (`2e58a343`, on main `d510b589`).

## Finding (TASK-254)

TASK-254 reads `placement` and tagged widths by rule. The traffic merge rule passes (Munich identical, Freiburg gate
62.5 to 60.6 s) and overlaps fall, but the geometry audit misses its tolerance:
- Sindelfingen A 81: voids 1,335 to 2,075 m². `placement=right_of:1` opens the real median between the carriageways;
  the audit takes a median as 0.5 m.
- Freiburg: bulge 9.07 to 15.89 m² at `n:536`, where the B 31 on-ramp joins the placed `r:538`.
- Sharp corners 60 to 62.

## Goal

The owner accepted (2026-11-28) that the audit counts a median the data place (the gap `placement` and tagged widths
open between paired carriageways) as a median, not a void. Then:
1. Change the audit so that gap is not a void; any other void is still counted. One rule, no per-id lists.
2. Trace the `n:536` bulge and fix it by rule (an on-ramp joining a placed carriageway), not by curation.
3. Bring TASK-254 onto current main (merge main into the branch or rebuild it on main), rebuild the bundled cities
   (`bench/bundled-cities.ts`) and re-pin.

## Scope

`bench/geometry-audit.ts`, `src/network/roads.ts`, `src/network/corridors.ts` and what the on-ramp join needs, tests,
bundled-city rebuilds and re-pins. Out of scope: OSM edits, per-id curation, gate floors, `bench/traffic-baseline.json`.

## Gates

- Traffic merge rule against main (Munich within 3%, full demand within 2% on the mean of seeds 1–5, Freiburg within
  5 s, drain, every showcase passes).
- Audit within tolerance against main on the changed audit (<1 cm, <1 m², one non-sharp corner), apart from the
  accepted median gaps; report the median area separately.
- A test for the audit rule and one for the on-ramp join, each failing without its change.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Result

**V2 passes the audit and traffic merge rule on `b5806054`.** V1 is retained in the comparison
because its Sindelfingen void total exceeded tolerance. This branch has not been pushed or merged
to main. The re-check with TASK-381 V2 is recorded below.

Merged frozen main `b5806054` into the task branch at `2cdba524`. The conflicted archives were
regenerated with `bench/bundled-cities.ts`. All comparisons below use that exact main, before the
later TASK-381 integration. No OSM edits, per-ID exceptions, schema changes, dependencies, traffic
baseline changes or gate-floor changes.

**Audit rule.** Measure 11 keeps the 0.5 m minimum and its existing station, direction and exclusion
tests. It checks the median-side edges implied by each OSM road's canonical line, placement and
lane widths against the edges with default widths and no placement. Where the tags open the gap,
the overlap of the drawn and mapped intervals on that ray is median. Space outside that interval
is still a void, even if the drawn gap has the right width. Roads with synthetic separation do not
establish mapped edges. The reported mapped area excludes the standard 0.5 m.

**Ramp rule.** At a balanced lane-gain merge or its reverse, locate the ramp's outer slice of the
wider carriageway after ordinary seam placement has settled. If the proposed placement increases
the required lateral jog, keep the wider block centred when the ramp is outside the 30°
continuation envelope or the peak smoothstep slope (`1.5 × jog / length`) would exceed that angle
even over the full mapped ramp link. The ordinary seam check then propagates the fallback. No lane
or legal movement is added or removed by the rule. Sources are CityFlows Architecture §5.1
“Lane layout”, TASK-221/TASK-235's carried tapers, and the committed OSM extracts.

At the B 31 group, `placement=left_of:2` on the three-lane receiving road increased the one-lane
ramp's intended jog from 3.50 to 5.25 m over an 11.67 m link. The carried transition put 6.25 m² of
the group surface outside its approach envelope. With the centred join the measured bulge is 0 m²,
as on main. The same fit rule removes the two added sharp corners at steeper ramp splits. It leaves
the A 81 placement intact, including the 132 m ramp approaching at 4.9°.

### Geometry audit

V1 preserved the same ramp rule but credited only the difference in nominal widths. It missed the
Sindelfingen void tolerance by 28.34 m² because the offset also exposes more of the mapped median
along the corridor. V2 uses the mapped bounds on each ray and passes. The original TASK-254 merge
before the ramp fix had 15.89 m² of Freiburg bulge and 62 sharp corners.

| City and measure | Main | V1 | V2 |
| --- | ---: | ---: | ---: |
| Munich width max / P95 (m) | 4.983 / 0.033 | 4.983 / 0.033 | 4.983 / 0.033 |
| Munich overlap / lane overlap / end overlap (m²) | 138.28 / 170.34 / 20.92 | 138.28 / 170.34 / 20.92 | 138.28 / 170.34 / 20.92 |
| Munich bulge / void (m²) | 17.00 / 15,578.45 | 17.00 / 15,578.45 | 17.00 / 15,578.45 |
| Munich sharp corners | 15 | 15 | 15 |
| Sindelfingen width max / P95 (m) | 6.279 / 0.051 | 6.279 / 0.055 | 6.279 / 0.055 |
| Sindelfingen overlap / lane overlap / end overlap (m²) | 287.49 / 640.41 / 231.79 | 224.05 / 578.25 / 231.79 | 224.05 / 578.25 / 231.79 |
| Sindelfingen bulge (m²) | 111.00 | 111.00 | 111.00 |
| Sindelfingen residual void (m²) | 1,334.55 | **1,362.89** | **1,266.19** |
| Sindelfingen sharp corners | 25 | 25 | 25 |
| Freiburg width max / P95 (m) | 10.490 / 0.104 | 10.490 / 0.102 | 10.490 / 0.102 |
| Freiburg folded back-step (m) / crossings | 3.47 / 2 | 1.46 / 0 | 1.46 / 0 |
| Freiburg overlap / lane overlap / end overlap (m²) | 15.50 / 92.35 / 25.11 | 12.19 / 89.25 / 25.30 | 12.19 / 89.25 / 25.30 |
| Freiburg bulge / void (m²) | 9.07 / 3,515.60 | 9.64 / 3,442.82 | 9.64 / 3,442.82 |
| Freiburg B 31 group bulge (m²) | 0 | 0 | 0 |
| Freiburg sharp corners / corners under 2 m | 60 / 123 | 60 / 122 | 60 / 122 |

| Mapped median above 0.5 m (m²) | Main | V1 | V2 |
| --- | ---: | ---: | ---: |
| Munich | 0 | 0 | 0 |
| Sindelfingen `r:464/r:543` | 0 | 590.38 | 590.02 |
| Sindelfingen `r:1252/r:545` | 0 | 121.63 | 218.17 |
| Sindelfingen total | 0 | 712.01 | **808.19** |
| Freiburg | 0 | 0 | 0 |

Munich and both synthetic controls are unchanged. Sindelfingen's P95 increases 0.4 cm and three
more roads cross the 5 cm reporting threshold, with no increase in maximum width error. The
Freiburg bulge increase is 0.57 m² at `n:607`, not the B 31. Named cases stay within the lead's
tolerance. The J2 group has one additional non-sharp nose at `r:1577>r:1572` (1.09 m radius, 27.9°)
and one fewer corner under 2 m. The full per-measure tables are in the scratch gate evidence.

### Munich merge rule

Canonical and compiled Munich inputs, including diagnostics, match frozen main with actuation
forced on and off. The demand, routing, simulation and probe code is unchanged. The table uses
the runs on frozen main for both versions, with two independent branch spot checks. At 0.15,
actuated seed 1 with choice off reproduced hash `2303892435` and the entire drain record. At full
demand, fixed seed 4 reproduced hash `2143378925`, trip counts and exact mean delay.

| Demand | Signals | Choice | Seeds | Main delay (s) | V1 / V2 delay (s) | Change | Mean completed | Gridlocked sum |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.15 | Actuated | Off | 12 | 607.514 | 607.514 | 0.00% | 5,312.50 | 0 |
| 0.15 | Actuated | On | 12 | 86.749 | 86.749 | 0.00% | 2,552.25 | 0 |
| 0.15 | Fixed | Off | 12 | 788.881 | 788.881 | 0.00% | 5,305.25 | 7 |
| 0.15 | Fixed | On | 12 | 124.181 | 124.181 | 0.00% | 2,529.92 | 0 |
| 1.00 | Actuated | Off | 5 | 1,758.017 | 1,758.017 | 0.00% | 3,572.60 | 802 |
| 1.00 | Fixed | Off | 5 | 1,796.314 | 1,796.314 | 0.00% | 3,222.40 | 843 |

All 48 reduced-demand runs met TASK-154's drain criterion as measured by `bench/seed-report.ts`.
No sustained dependency rings, no inner link above its box wait at 10:00, and no stalled heads.
The worst loop-road visit added 280.7 s against the 900 s limit. Full-demand values are the means
of seeds 1–5 at scale 1 with choice off, as in TASK-279. Full-demand overload is unchanged.

### Freiburg and Sindelfingen traffic

Both versions have identical traffic inputs. The reviewed V2 ordering change passed its independent
regression without changing any rebuilt bundle or the measured raw-city traffic digests.
Morning runs are 07:00–10:00 at 0.15 demand, choice on, with each city's default signal programs.

| City and seed | Mean delay main → V1 / V2 (s) | Change (s) | Trips completed | State hash |
| --- | ---: | ---: | ---: | --- |
| Freiburg 1 (gate) | 61.001 → 61.347 | +0.346 | 1,527 → 1,528 | `55277987` → `2581833985` |
| Freiburg 2 | 57.279 → 59.009 | +1.730 | 1,503 → 1,508 | `82669502` → `2806985937` |
| Freiburg 3 | 59.131 → 61.465 | +2.334 | 1,527 → 1,522 | `1930469067` → `2540522972` |
| Sindelfingen 1 | 17.149 → 17.152 | +0.003 | 444 → 444 | `3304791903` → `1073629736` |

No gridlocks or stalled heads on either side. Freiburg's gate added at most 187.1 s on one road
visit. The gate is within 5 s and so are both additional Freiburg seeds.

### Rebuilds and re-pins

All real bundles were rebuilt. Freiburg (10 width changes, 33 kept non-synthetic placements),
Sindelfingen (3 placements), Lübeck (9 width changes, 8 placements) and York (4 width changes)
changed bytes against main. Munich, Philadelphia, London City Airport, Heathrow, Zurich Airport
and the pinned Boston archive did not.

- Freiburg archive `city.json` SHA-256 `2196f2e5…` → `0bd5bef9…` and morning state hash as above.
  Eight tram route IDs move up by one, and the timetable hash `773256d9` → `427b4cee`. The routes,
  eight 10-per-hour headways and 32 served stops are unchanged.
- Freiburg rail geometry `39d8defb…` → `673df053…` and 3D walk and footbridges
  `5bcbbed5…` → `1d78a8ee…`. The carried B 31 branch again passes the original 0.1 m width bound.
  The inherited TASK-254 paint and footbridge pins remain 146 keep-clear boxes, 1,960 / 2,044
  dashes and 71 footbridge piers.
- Sindelfingen V107/V117 compiled network `429ecf09…` → `8a0ceca1…` and 3D walk and
  footbridges `9fe5cb9f…` → `69505d30…`. The inherited TASK-254 Sindelfingen pins cover import
  geometry, parking and connectors, the walk and rail networks, vegetation and marking geometry.
  V117 curbs `dfa5d8eb…` → `7206cc4a…`, German markings `d5d2bbc6…` → `3bdad205…` and US
  markings `171f7361…` → `f4b471c8…`. Lamp placement and zero sign collisions are unchanged.

### Showcase gates

| Showcase | Morning gate |
| --- | --- |
| Freiburg | Pass |
| Munich | Pass |
| Sindelfingen | Pass |
| Philadelphia | Pass |
| Lübeck | Pass |
| York | Pass |
| London City Airport | Pass |
| Zurich Airport | Pass |

Each passed the existing limits for gridlock, stalled heads, routing, parking failure rate and
single-road-visit delay. Heathrow is in the panel without this gate by the prior owner decision
(TASK-354). Boston remains held out. Both archives matched frozen main and their pins passed.

### Verification tiers

All commands exited 0. The traffic-light invocation included the standalone Munich mode-share
guard, and Playwright used `CITYFLOWS_TEST_PORT=5392`.

```text
npm run check
 Test Files  310 passed | 1 skipped (311)
      Tests  2247 passed | 2 skipped (2249)
✓ built in 2.06s

npm run test:city
 Test Files  77 passed (77)
      Tests  293 passed | 1 skipped (294)

npm run test:traffic:light -- tests/traffic/munich-mode-share.test.ts
 Test Files  3 passed (3)
      Tests  9 passed | 1 expected fail (10)

npm run test:e2e:light
  63 passed (5.4m)
```

The synthetic median/ramp regressions were red without their changes and now pass, including the
displaced equal-width gap and a provisional ramp placement discarded at its far end. The B 31
city regression also checks the group outline and the lane seam together.

### Re-check on main with TASK-381

With TASK-381 V2 in both builds (main `23a76314`), Freiburg's 10:00 gate moved from 59.635 to
60.597 s (+0.963 s, within 5 s), with 1,528 to 1,529 completed trips and no failed trips or
stalled heads. Its state hash was the only merge conflict and was measured again before
re-pinning: main `3430388558`, old branch `2581833985`, combined `3918479990`. Rebuilding all ten
bundled projects changed no branch bytes. Sindelfingen completed 444 trips on each side at
17.147 and 17.150 s mean delay. The five-city and 23-case geometry audits reproduced the earlier
reports exactly, including Sindelfingen's 1,266.19 m² of counted void and 808.19 m² of mapped
median, and no bulge at the B 31 group. Munich's canonical and compiled inputs and diagnostics
matched for both actuated and fixed signals, so the seed matrices were not rerun. All nine
showcases passed, including the separate Heathrow probe, whose result was identical to main.
All four airport startup tests passed with TASK-381's pins unchanged.
