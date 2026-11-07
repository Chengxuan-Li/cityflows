import { describe, expect, it } from 'vitest';
import { buildCity } from '../../src/fixtures/build-city';
import { createGeoReference } from '../../src/geo/projection';
import { importGeoJson } from '../../src/importers/geojson';
import { exportGeoJson } from '../../src/project/geojson';
import { allocateId, type Place } from '../../src/schema';

describe('exportGeoJson', () => {
  it.each([false, true])('round-trips roads and places (geographic: %s)', (geographic) => {
    const { city, node, road, signal } = buildCity('Test', 1);
    if (geographic) {
      city.geo = {
        ...createGeoReference({ lon: -73, lat: 40 }),
        bbox: [-74, 39, -72, 41],
        source: {
          kind: 'file',
          snapshotDate: null,
          attribution: '',
          importerVersion: 'test',
          inferredCount: 0,
        },
      };
    }
    const start = node(10, 20);
    const end = node(80, 50);
    const inbound = road(start, end, { lanes: 2, roadClass: 'primary', via: [{ x: 45, y: 30 }] });
    const outbound = road(end, node(160, 55), { roadClass: 'service', speedKmh: 20 });
    inbound.name = 'Main';
    inbound.lanes[0] = { widthM: 4, allowed: ['bus'] };
    inbound.provenance = { source: 'authored' };
    outbound.provenance = { source: 'authored' };
    end.turnRules.push({
      from: inbound.id,
      to: outbound.id,
      fromLane: 0,
      allowed: true,
      provenance: { source: 'authored' },
    });
    signal(end, [[inbound, outbound]]);
    end.signal!.phases[0]!.groups.push({ from: inbound.id, to: outbound.id });
    const place: Place = {
      id: allocateId(city, 'p'),
      name: 'Market',
      kind: 'retail',
      shape: {
        kind: 'polygon',
        ring: [
          { x: 15, y: 30 },
          { x: 30, y: 25 },
          { x: 30, y: 30 },
        ],
      },
      population: 0,
      jobs: 25,
      attraction: 1,
      capacity: null,
      connectors: [],
      profile: null,
      events: [],
      provenance: { source: 'authored' },
    };
    city.places[place.id] = place;
    const exported = exportGeoJson(city);
    expect(exported['cityflows:lossy']).toEqual(
      expect.arrayContaining(['lanes.widthM', 'lanes.allowed', 'turnRules', 'signals']),
    );
    const line = exported.features[0]!;
    expect(line).toMatchObject({
      geometry: { type: 'LineString' },
      properties: { 'cityflows:id': inbound.id, oneway: true, name: 'Main', lanes: 2 },
    });
    const polygon = exported.features.find((feature) => feature.geometry.type === 'Polygon')!;
    const ring = polygon.geometry.coordinates[0] as number[][];
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring.at(-1));
    if (geographic) {
      expect(ring[1]![1]).toBeCloseTo(ring[0]![1]!, 10);
      expect(ring[2]![1]).toBeGreaterThan(ring[1]![1]!);
    }

    const target = { ...buildCity('Empty', 1).city, geo: city.geo };
    const result = importGeoJson(target, JSON.parse(JSON.stringify(exported)));
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    for (const original of [inbound, outbound]) {
      const restored = result.city.roads[original.id]!;
      expect(restored).toMatchObject({
        roadClass: original.roadClass,
        speedLimitMps: original.speedLimitMps,
        name: original.name,
      });
      expect(restored.lanes).toHaveLength(original.lanes.length);
      expect(restored.centerline).toHaveLength(original.centerline.length);
      restored.centerline.forEach(({ x, y }, i) => {
        expect(x).toBeCloseTo(original.centerline[i]!.x, 6);
        expect(y).toBeCloseTo(original.centerline[i]!.y, 6);
      });
    }
    expect(result.city.roads[inbound.id]!.to).toBe(result.city.roads[outbound.id]!.from);
    expect(result.city.roads[inbound.id]!.lanes[0]).toEqual({
      widthM: 3.5,
      allowed: ['car', 'van', 'truck', 'bus'],
    });
    const junction = result.city.nodes[result.city.roads[inbound.id]!.to]!;
    expect(junction).toMatchObject({ control: 'uncontrolled', signal: null, turnRules: [] });
    expect(result.city.places[place.id]).toMatchObject({
      name: 'Market',
      kind: 'retail',
      jobs: 25,
      shape: { kind: 'polygon', ring: [expect.anything(), expect.anything(), expect.anything()] },
    });
  });
});
