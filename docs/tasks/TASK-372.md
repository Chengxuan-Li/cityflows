# TASK-372 — Walker priority by country: UK turning-out yield (Highway Code H2), US unmarked crosswalks

Status: parked 2026-11-27 (branch `task/372-walker-country` at `ec1ebd5d`): London City gridlocks one trip and its worst visit is 1,472.7 s against the 900 s limit with the UK rule. The US part passes and goes on in TASK-373. Owner said "start both"; city work merges under the traffic merge rule. Owner: Codex
(gpt-6.2-sol, high). Base: main `5f172cb6`.

## Finding (TASK-279)

TASK-279 reads every unmarked crossing by the German rules: a walker has no priority (StVO §25(3)), except over drivers
turning into the crossed arm (§9(3)). It applies these to every map:
- **UK maps (York, London City, Heathrow).** The Highway Code also asks a driver turning *out of* a road to give way
  to pedestrians crossing or waiting to cross it (rules 170 and H2). That is not modelled.
- **US maps (Philadelphia, Boston).** In most states, walkers have the right of way at unmarked crosswalks at
  intersections (Uniform Vehicle Code §11-502; Pennsylvania 75 Pa.C.S. §3542; Massachusetts G.L. c. 89 §11). Away
  from intersections they yield (UVC §11-503).
- **Swiss maps (Zurich).** Walkers have priority only at zebras (SVG Art. 49, VRV Art. 47), which matches the German
  reading.

London City's mean delay rose from 210 to 386 s with TASK-279; its worst visit is 822 s against the 900 s showcase limit.

## Goal

Read crossing priority by country:
- `de` and `ch`: as now.
- `gb`: add the turning-out yield, H2.
- `us`: walkers have priority at unmarked crossings at an intersection node, as at a zebra; not at mid-block
  unmarked crossings.
- Unknown country: as now.

The city needs a country. This task authorises one contract change: an optional `country` (ISO 3166-1 alpha-2,
lower case) on the city schema, with a history migration if one is needed, documented in `docs/architecture.md`.
- Bundled projects get it when they are rebuilt.
- The importer sets it from the city's `geo` using a small table of country boxes for the supported countries (de, ch,
  gb, us).
- Without it, the current rule applies.

Do not read `drivingSide` as a country.

## Scope

`src/schema` (the one optional field and its migration), `src/importers` (setting it), `src/network/walk.ts` and
`src/sim/walkers.ts` (the rules), `docs/architecture.md` (sections 5.4 and 5.5, and the schema section), tests,
bundled-city rebuilds (`bench/bundled-cities.ts`, all of them) and re-pins.

Out of scope: gate floors, `bench/traffic-baseline.json`, OSM edits, per-id curation, signal programs.

## Gates

- A test per rule that fails without it: gb turning out, us intersection versus mid-block, de unchanged.
- German and Swiss cities (Munich, Freiburg, Sindelfingen, Lübeck, Zurich) identical, by hash.
- UK and US cities: every showcase gate passes. Report London City, York, Heathrow, Philadelphia and Boston against
  main: completed, mean delay, worst visit, walker waits, and vehicle seconds lost to yields.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

If the first version fails a showcase, at most one variant, with both tables.

## Result

**Failed the showcase gate. Keep this branch out of main.** Measured against main
`bdf28fc8`. London City gridlocked one trip and its worst road visit increased from 822.3 s to
1,472.7 s in both attempts, over the unchanged 900 s limit. The variant recovered Heathrow.
York, Philadelphia and all five German and Swiss cities passed. Boston is still held out.

The first version asked UK drivers turning out to yield even before the walker had a gap in
other traffic. The single variant, retained here, uses the same gap check for turns out as for
turns in. It also restricts US priority to generated or anchored junction crossings, excluding
midblock crossings near a junction and parking aisles that do not make a public junction.
No third version was tried. The US rule changes priority only, not paint or crossing-kind
metrics. Marked or signal crossings, `de`, `ch`, absent country and unsupported countries
keep the prior rules.

The optional lowercase two-letter country comes from the OSM project's geographic centre and
coarse offline boxes. It does not come from the driving side, display theme or OSM country tags.
Projects without it still open under the existing rule. Neither schema version nor history
needed a migration. Legal references are in the Finding and architecture section 5.4.

### UK and US mornings

The task reuses TASK-279's showcase probe: seed 1, demand 0.15, mode choice on, 07:00 to 10:00.
Worst visit is added wait on one road, sampled once per simulated second. Mean walker wait
is per crossing taken (all kinds weighted by crossings, then unmarked alone). Yield loss sums
the vehicle time lost against desired speed while a walker stop is binding.

Main Boston crashed in the airport ground-vehicle path before 10:00
(`pointAtDistance` from `ground-vehicles.ts`'s `boxAt`). Its three measurements instead use the same
landside-only probe with the compiled airside disabled in the scratch harness on each revision.
That road probe fails even on main and is not a passing airport showcase.

#### Main versus first version

| City | Completed | Mean delay (s) | Worst visit (s) | Mean walker wait (s, all / unmarked) | Vehicle seconds lost to yields | Drain (gridlocks / stalled heads / no route; parking / local arrivals) |
|---|---:|---:|---|---:|---:|---|
| London City | 1,993 → 1,988 | 385.7 → 705.6 | 822.3 (r:274) → 1,472.7 (r:6) | 0.64 / 0.64 → 0.56 / 0.56 | 1,514.9 → 1,389.9 | Pass (0 / 0 / 0; 0/1400) → Fail (1 / 0 / 0; 0/1395) |
| York | 1,801 → 1,801 | 84.7 → 83.8 | 156.4 (r:3109) → 155.2 (r:3109) | 0.83 / 0.46 → 0.76 / 0.37 | 2,672.8 → 3,061.0 | Pass (0 / 0 / 0; 25/1540) → Pass (0 / 0 / 0; 25/1540) |
| Heathrow | 4,033 → 4,026 | 205.4 → 217.0 | 896.1 (r:10331) → 942.3 (r:10331) | 0.79 / 0.60 → 0.72 / 0.48 | 4,303.8 → 5,382.3 | Pass (0 / 0 / 0; 36/2928) → Fail (0 / 0 / 0; 36/2917) |
| Philadelphia | 4,689 → 4,665 | 151.0 → 160.7 | 412.5 (r:1333) → 466.6 (r:61) | 3.89 / 1.36 → 4.28 / 0.33 | 41,912.3 → 43,879.4 | Pass (0 / 0 / 0; 0/3597) → Pass (0 / 0 / 0; 0/3573) |
| Boston Logan, landside only | 5,342 → 5,643 | 1755.9 → 1791.6 | 3,503.3 (r:458) → 3,529.7 (r:3335) | 11.33 / 4.39 → 8.89 / 2.84 | 40,182.8 → 44,200.2 | Fail (53 / 0 / 0; 0/3553) → Fail (50 / 0 / 0; 0/3672) |

#### Main versus variant

| City | Completed | Mean delay (s) | Worst visit (s) | Mean walker wait (s, all / unmarked) | Vehicle seconds lost to yields | Drain (gridlocks / stalled heads / no route; parking / local arrivals) |
|---|---:|---:|---|---:|---:|---|
| London City | 1,993 → 1,988 | 385.7 → 705.6 | 822.3 (r:274) → 1,472.7 (r:6) | 0.64 / 0.64 → 0.56 / 0.56 | 1,514.9 → 1,388.1 | Pass (0 / 0 / 0; 0/1400) → Fail (1 / 0 / 0; 0/1395) |
| York | 1,801 → 1,801 | 84.7 → 84.3 | 156.4 (r:3109) → 155.1 (r:3109) | 0.83 / 0.46 → 0.76 / 0.36 | 2,672.8 → 2,950.8 | Pass (0 / 0 / 0; 25/1540) → Pass (0 / 0 / 0; 25/1540) |
| Heathrow | 4,033 → 4,023 | 205.4 → 206.7 | 896.1 (r:10331) → 544.9 (r:10331) | 0.79 / 0.60 → 0.76 / 0.48 | 4,303.8 → 5,273.5 | Pass (0 / 0 / 0; 36/2928) → Pass (0 / 0 / 0; 36/2918) |
| Philadelphia | 4,689 → 4,679 | 151.0 → 153.8 | 412.5 (r:1333) → 579.6 (r:255) | 3.89 / 1.36 → 3.68 / 0.31 | 41,912.3 → 44,619.4 | Pass (0 / 0 / 0; 0/3597) → Pass (0 / 0 / 0; 0/3587) |
| Boston Logan, landside only | 5,342 → 5,558 | 1755.9 → 1734.6 | 3,503.3 (r:458) → 3,216.0 (r:458) | 11.33 / 4.39 → 9.37 / 2.14 | 40,182.8 → 41,277.6 | Fail (53 / 0 / 0; 0/3553) → Fail (54 / 0 / 0; 0/3682) |

### Unchanged German and Swiss traffic

Main and the variant have the same full compiled graph digest, 10:00 state hash and showcase
outcome for each city. The raw archives necessarily get new hashes from the new metadata.

| City | Shared compiled SHA-256 | Shared state hash | Completed | Mean delay (s) | Worst visit (s) |
|---|---|---:|---:|---:|---:|
| Munich | `c56ef5308c9ab8c15c53cd5fd15771630adb13c2f2efb0daa2fb055bb336ce6e` | `3476462186` | 2,581 | 84.0 | 562.0 |
| Freiburg | `983018042832800563873b6f7290e41bac2d344f10757ccbf4fcfa24be91453e` | `55277987` | 1,527 | 61.0 | 199.5 |
| Sindelfingen | `4c54550891a7e0f74fb6345c453d48fe414812ddd08085c380c5148b7d3ae626` | `3304791903` | 444 | 17.1 | 90.3 |
| Lübeck | `32cf9bca9023d7d4e0c9470667c0dd3fa0edfb90da420e1396435cf6073c218f` | `2208290527` | 2,488 | 119.5 | 78.9 |
| Zurich | `51e86d3f4058fa509762e0b914aa699f0b0a6b83d8e0ebf87d74323d73bdbcfe` | `3605125020` | 4,277 | 111.8 | 246.9 |

### Rebuild and verification

`bench/bundled-cities.ts` rebuilt the nine extract-based archives, including York and Zurich,
and refreshed pinned Boston from its stored geo. The byte comparison after removing
`country` and restoring the city digest matches main for all ten files. No OSM, signal
programs, gate floors, traffic baseline or dependencies changed. Freiburg's city digest
and the four pinned airport archive SHA-256 digests were updated. The airport startup test
re-pins the London City, Boston and Heathrow graphs and the Boston and Heathrow first-minute
states. Zurich's graph and startup states, and all four flight boards, are unchanged. T44, T49
and T75 retain the old German network hashes after excluding the new metadata, whose value
they check separately.

| Command | Status | Final lines |
|---|---|---|
| `npm run check` | PASS | `Tests  2213 passed \| 2 skipped (2215) · ✓ built in 1.66s` |
| `npm run test:city` | FAIL | `Test Files  1 failed \| 76 passed (77) · Tests  1 failed \| 290 passed \| 1 skipped (292) · Duration  2046.73s (tests 99%, import 1%)` |
| `npm run test:traffic:light` | PASS | `Test Files  2 passed (2) · Tests  5 passed \| 1 expected fail (6) · Duration  210.49s (tests 100%)` |
| `npm run test:e2e:light` | PASS | `63 passed (5.8m) · port 5394` |
| `Airport startup pins` | PASS | `Tests  4 passed (4) · Duration  70.89s (tests 99%)` |

Evidence is under `D:/cityflows-wt/330-pilot/R/t372/out`.
