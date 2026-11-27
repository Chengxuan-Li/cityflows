# TASK-372 — Walker priority by country: UK turning-out yield (Highway Code H2), US unmarked crosswalks

Status: started 2026-11-27 (owner: "start both"; city work merges under the traffic merge rule). Owner: Codex
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
