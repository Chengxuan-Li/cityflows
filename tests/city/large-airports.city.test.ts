import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createGeoReference, lonLatToLocal } from '../../src/geo/projection';
import { importAirport } from '../../src/importers/osm/airport';
import { parseOsm } from '../../src/importers/osm/parse';
import type { Diagnostic } from '../../src/network';
import type { City } from '../../src/schema';
import type { Airport } from '../../src/schema/airport';
import { airportSchema } from '../../src/schema/airport.schema';
import { limit } from '../timeouts';

const extracts = [
  {
    file: 'zurich-airport',
    bbox: [8.5307, 47.438, 8.5802, 47.4858],
    runways: ['14/32', '10/28', '16/34', 'H01/H19'],
    crossings: ['10/28 × 16/34'],
    edges: { runway: 69, taxiway: 1180, lead_in: 301 },
    generatedTaxi: 1,
    holds: { osm: 183, generated: 1 },
    stands: { osm: 207, generated: 47 },
    standCodes: { A: 55, B: 109, C: 70, D: 8, E: 2, F: 4, null: 6 },
    terminals: [20, 1, 1],
    facilities: [105, 11, 12],
    unreachable: [],
    omitted: ['node/13264666259'],
  },
  {
    file: 'boston-logan',
    bbox: [-71.0368, 42.3439, -70.9817, 42.3823],
    runways: ['15R/33L', '09/27', '4R/22L', '4L/22R', '14/32', '15L/33R'],
    crossings: [
      '15R/33L × 09/27',
      '15R/33L × 4R/22L',
      '15R/33L × 4L/22R',
      '09/27 × 4R/22L',
      '4R/22L × 15L/33R',
      '4L/22R × 15L/33R',
    ],
    edges: { runway: 108, taxiway: 521, taxilane: 227, lead_in: 212 },
    generatedTaxi: 1,
    holds: { osm: 89 },
    stands: { osm: 124, generated: 46 },
    standCodes: { A: 12, B: 36, C: 91, D: 12, E: 14, F: 5 },
    terminals: [4, 6, 1, 1],
    facilities: [113, 4, 0],
    unreachable: ['D1', 'D2', 'D3', 'H1', 'H2', 'H3', 'NC12A/H6', 'NC13/H5', 'NC13A/H4'],
    omitted: Array.from({ length: 9 }, (_, i) => `node/${12292344243 + i}`),
  },
  {
    file: 'heathrow',
    bbox: [-0.4948, 51.454, -0.4115, 51.4804],
    runways: ['09R/27L', '09L/27R'],
    crossings: [],
    edges: { runway: 50, taxiway: 1501, lead_in: 313 },
    generatedTaxi: 0,
    holds: { osm: 288 },
    stands: { osm: 299, generated: 8 },
    standCodes: { A: 24, B: 39, C: 85, D: 39, E: 71, F: 46, null: 3 },
    terminals: [2, 2, 1, 1, 1, 4, 1, 1],
    facilities: [148, 5, 1],
    unreachable: [],
    omitted: [],
  },
] as const;

function count<T>(items: T[], key: (item: T) => string | number) {
  const totals: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    totals[k] = (totals[k] ?? 0) + 1;
  }
  return totals;
}

function reachableFromRunways(airport: Airport, runwayNodes: Set<string>[]) {
  const next = new Map<string, string[]>();
  for (const { from, to } of Object.values(airport.edges)) {
    next.set(from, [...(next.get(from) ?? []), to]);
    next.set(to, [...(next.get(to) ?? []), from]);
  }
  const seen = new Set(runwayNodes.flatMap((nodes) => [...nodes]));
  const queue = [...seen];
  while (queue.length)
    for (const node of next.get(queue.pop()!) ?? [])
      if (!seen.has(node)) {
        seen.add(node);
        queue.push(node);
      }
  return seen;
}

test.for(extracts)(
  '$file airside import pins its topology',
  { timeout: limit(60_000) },
  (entry) => {
    const data = parseOsm(readFileSync(`fixtures/osm/${entry.file}.osm`, 'utf8'));
    if (typeof data === 'string') throw new Error(data);
    const [west, south, east, north] = entry.bbox;
    const geo = createGeoReference({ lon: (west + east) / 2, lat: (south + north) / 2 });
    const min = lonLatToLocal(geo, { lon: west, lat: north });
    const max = lonLatToLocal(geo, { lon: east, lat: south });
    const ring = [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }, min];
    const positions = new Map(data.node.map((n) => [n.id, lonLatToLocal(geo, n)]));
    // Isolate the airside stage. Road-crossing behavior against imported roads is covered by the
    // inline airport integration test, and the real extracts' full road import is measured separately.
    const city: City = {
      schemaVersion: 3,
      version: 0,
      name: entry.file,
      drivingSide: 'right',
      geo: null,
      nodes: {},
      roads: {},
      places: {},
      nextId: 1,
    };
    const diagnostics: Diagnostic[] = [];
    importAirport(city, data, positions, { min, max, ring }, diagnostics);
    const airport = airportSchema.parse(city.airport);
    const runways = Object.values(airport.runways);
    const runwayNodes = runways.map(
      (r) => new Set(r.edges.flatMap((id) => [airport.edges[id]!.from, airport.edges[id]!.to])),
    );
    const crossings = runways.flatMap((a, i) =>
      runways
        .slice(i + 1)
        .flatMap((b, j) =>
          [...runwayNodes[i]!].some((node) => runwayNodes[i + j + 1]!.has(node))
            ? [`${a.ref} × ${b.ref}`]
            : [],
        ),
    );
    const edges = Object.values(airport.edges);
    const stands = Object.values(airport.stands);
    const reachable = reachableFromRunways(
      airport,
      runwayNodes.filter((_, i) => runways[i]!.maxCode !== null),
    );
    const reachableOsm = new Set([...reachable].map((node) => airport.nodes[node]!.osmId));
    const unreachable = stands
      .filter((s) =>
        s.leadIn.length
          ? !reachable.has(airport.edges[s.leadIn[0]!]!.from)
          : !s.osmIds.some((id) => reachableOsm.has(id)),
      )
      .map((s) => s.ref)
      .sort();

    expect(runways.map((r) => r.ref)).toEqual(entry.runways);
    expect(crossings).toEqual(entry.crossings);
    expect(count(edges, (e) => e.kind)).toEqual(entry.edges);
    expect(
      edges.filter((e) => e.kind !== 'lead_in' && e.provenance.source === 'generated'),
    ).toHaveLength(entry.generatedTaxi);
    expect(count(Object.values(airport.holdingPositions), (h) => h.provenance.source)).toEqual(
      entry.holds,
    );
    expect(
      count(stands, (s) =>
        s.leadIn.some((id) => airport.edges[id]!.provenance.source === 'generated')
          ? 'generated'
          : 'osm',
      ),
    ).toEqual(entry.stands);
    expect(count(stands, (s) => String(s.maxCode))).toEqual(entry.standCodes);
    expect(Object.values(count(Object.values(airport.terminals), (t) => t.group))).toEqual(
      entry.terminals,
    );
    expect([
      Object.keys(airport.gates).length,
      airport.hangars.length,
      Object.keys(airport.helipads).length,
    ]).toEqual(entry.facilities);
    expect(unreachable).toEqual(entry.unreachable);
    expect(diagnostics.filter((d) => d.code === 'airport_unjoined').flatMap((d) => d.refs)).toEqual(
      entry.omitted,
    );
  },
);
