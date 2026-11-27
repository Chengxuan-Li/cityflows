# TASK-373 — US walker priority at unmarked junction crosswalks, without the UK rule

Status: merged 2026-11-27 (`8a6ef0d2`): de/ch/gb cities identical by hash, Philadelphia passes, airside identical. Started as the lead default after TASK-372; city work merges under the traffic merge rule). Owner: Codex
(gpt-6.2-sol, high). Base: branch `task/372-walker-country` at `ec1ebd5d`.

## Finding (TASK-372)

TASK-372 added an optional `country` on the city schema, set by the importer from `geo`, and two rules:
- **gb:** drivers turning out of the crossed arm also yield (Highway Code H2). London City then gridlocks one trip and
  its worst visit rises from 822.3 s to 1,472.7 s, over the 900 s limit, in both versions.
- **us:** walkers have priority at unmarked crossings at a junction, as at a zebra; not mid-block. Philadelphia passes:
  completed 4,689 → 4,679, mean delay 151.0 → 153.8 s, worst visit 412.5 → 579.6 s. Boston is held out.

German and Swiss cities were identical by hash.

## Goal

Keep the `country` field and the US rule; turn the UK rule off, so that `gb` reads like `de`. Keep the gb test and code
behind a switch only if it stays small and off by default; otherwise remove it (the branch keeps it).

## Scope

As TASK-372: `src/schema` (the optional field), `src/importers`, `src/network/walk.ts`, `src/sim/walkers.ts`,
`docs/architecture.md` (5.4, 5.5, schema), tests, bundled-city rebuilds and re-pins.

Out of scope: gate floors, `bench/traffic-baseline.json`, OSM edits, per-id curation, signal programs.

## Gates

- de/ch cities (Munich, Freiburg, Sindelfingen, Lübeck, Zurich) and gb cities (York, London City, Heathrow)
  identical to main by state hash; only the `country` metadata and the city digest differ.
- Philadelphia showcase passes; report completed, mean delay, worst visit, walker waits, vehicle seconds lost to
  yields against main.
- Airside unchanged: Heathrow peak seed 1 and the London City day identical to main.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Result

**Pass.** Removed TASK-372's UK turn-out yield rather than adding a switch. The GB crossing
rule is now the same as DE. The optional `City.country` and US priority at generated or
anchored unmarked public junction crossings are unchanged from TASK-372. Midblock crossings,
marked crossings and signal crossings retain their previous rules. Boston remains held out.

### Morning showcase

Seed 1, 07:00 to 10:00, 0.15 persons per resident, mode choice on. Branch runs were compared
against the saved `bdf28fc8` main probes. Main `b75d9ff2` changes only docs since that revision.
All eight non-US cities matched main's 10:00 state and full compiled graph hashes.
London City returned to zero gridlocks and an 822.3 s worst visit, below the unchanged 900 s
limit. Heathrow's worst visit was 896.1 s on both revisions.

| City | Country | Shared 10:00 state hash | Shared compiled SHA-256 |
|---|---|---:|---|
| Munich | `de` | `3476462186` | `c56ef5308c9ab8c15c53cd5fd15771630adb13c2f2efb0daa2fb055bb336ce6e` |
| Freiburg | `de` | `55277987` | `983018042832800563873b6f7290e41bac2d344f10757ccbf4fcfa24be91453e` |
| Sindelfingen | `de` | `3304791903` | `4c54550891a7e0f74fb6345c453d48fe414812ddd08085c380c5148b7d3ae626` |
| Lübeck | `de` | `2208290527` | `32cf9bca9023d7d4e0c9470667c0dd3fa0edfb90da420e1396435cf6073c218f` |
| Zurich | `ch` | `3605125020` | `51e86d3f4058fa509762e0b914aa699f0b0a6b83d8e0ebf87d74323d73bdbcfe` |
| York | `gb` | `1229401121` | `a5bd70e88eaf02c8d532acfd1ed5b50c2ed9a8759b4c16c65d942721c6420683` |
| London City | `gb` | `821146038` | `b1e9997f9ca2904f7659e4eb9e2889b8eded2520697cedd0c580b32970bce898` |
| Heathrow | `gb` | `2254264010` | `01d51ca2d060e66af89ab129ead04f8f8d2562df13b42d463c581ad45ba58329` |

Philadelphia passed and exactly reproduced TASK-372's variant. Worst visit is added wait
on one road, sampled once per simulated second. Mean walker wait is per crossing taken.
Yield loss sums vehicle time lost against desired speed while a walker stop is binding.
Neither revision had gridlocks, stalled heads, unroutable trips or parking failures.

| Philadelphia metric | Main | TASK-373 |
|---|---:|---:|
| Completed vehicle trips | 4,689 | 4,679 |
| Mean vehicle delay (s) | 151.0 | 153.8 |
| Worst road visit (added s) | 412.5 (`r:1333`) | 579.6 (`r:255`) |
| Mean walker wait, all crossings (s) | 3.89 | 3.68 |
| Mean walker wait, unmarked (s) | 1.36 | 0.31 |
| Vehicle seconds lost to walker yields | 41,912.3 | 44,619.4 |
| Drain | Pass (0/3,597 parking failures / local arrivals) | Pass (0/3,587 parking failures / local arrivals) |
| 10:00 state hash | `1846134865` | `1140924153` |

### Airside

`bench/airside-delay.ts`, seed 1 with `--checks`. Compared all JSON fields including individual
arrivals and departures. The reports match exactly after excluding `wallS` (wall time).
The standard main references are TASK-370's `v2-lhr-p1` and `v2-lcy-d1`. Commit `72d2fbb2`
and main `b75d9ff2` have identical source, bench, tests, dependencies and fixtures. The table
hashes the canonical report without `wallS`.

| Airside run | Completed / scheduled | Go-arounds | Aircraft overlap samples | Real runway conflicts | Shared report SHA-256 |
|---|---:|---:|---:|---:|---|
| Heathrow peak, 06:00–08:00, drain to 09:00 | 145 / 188 | 4 | 0 | 0 | `aafe701d986ad533f606dd00efd6fc6c066c850210a900166c6a2943b01fa021` |
| London City, full day | 150 / 150 | 0 | 0 | 0 | `58013230209e565b4bdb688917a9aaae0f86c16f05b6c8f9138428d62be6657e` |

Fresh runs on both revisions with `--vehicles --checks` also matched in every field but
`wallS`, with zero vehicle-aircraft and vehicle-vehicle overlaps.

| Airside run with ground vehicles | Completed / scheduled | Go-arounds | Aircraft overlap samples | Real runway conflicts | Shared report SHA-256 |
|---|---:|---:|---:|---:|---|
| Heathrow peak, 06:00–08:00, drain to 09:00 | 148 / 188 | 4 | 0 | 0 | `96bc82f54c7fa3ad0755395a62addc16a35fad68e99aed9320d28f195af7a345` |
| London City, full day | 150 / 150 | 0 | 0 | 0 | `864a2424479c7ecbbdd754fa03eef29cbc20fed06fdac07cd0c053e17f04baa0` |

### Rebuild and verification

Ran `bench/bundled-cities.ts` for all ten archives, including the pinned Boston layout. They
reproduced TASK-372's bytes. Removing `country` and restoring just the `city.json` manifest
digest produces main's exact archive bytes for all ten. No OSM, signal programs, gate floors,
traffic baseline or dependencies changed.

The country-only archive SHA-256 pins for London City, Zurich, Boston and Heathrow and
Freiburg's city digest pin stay as rebuilt in TASK-372. Restored London City's and Heathrow's
compiled graph pins and Heathrow's first-minute state pin to main. Boston's US graph and
first-minute state pins stay at TASK-372's values. All loaded states and flight-board hashes
match main. T44, T49 and T75 keep their German network pins after excluding the new country
metadata, which they check separately.

| Command | Status | Final lines |
|---|---|---|
| `npm run check` | Pass | `Test Files  307 passed \| 1 skipped (308) · Tests  2212 passed \| 2 skipped (2214) · Duration  829.31s (tests 87%, import 11%, transform 1%) · ✓ built in 2.25s` |
| `npm run test:city` | Pass | `Test Files  77 passed (77) · Tests  291 passed \| 1 skipped (292) · Duration  2512.14s (tests 99%, import 1%)` |
| `npm run test:traffic:light` | Pass | `Test Files  2 passed (2) · Tests  5 passed \| 1 expected fail (6) · Duration  257.24s (tests 99%)` |
| `npm run test:e2e:light` | Pass | `63 passed (6.0m) · port 5394` |
| `Airport startup pins` | Pass | `Test Files  1 passed (1) · Tests  4 passed (4) · Duration  84.75s (tests 99%)` |

Evidence is in `D:/cityflows-wt/330-pilot/R/t373/out`.
