import { describe, expect, it } from 'vitest';
import { grid5x5 } from '../../src/fixtures/grid5x5';
import { createGeoReference } from '../../src/geo/projection';
import { importGeoJson } from '../../src/importers/geojson';
import { compile } from '../../src/network';
import type { City } from '../../src/schema';

function road(coordinates: number[][], properties: Record<string, unknown> = {}) {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties };
}

function collection(...features: unknown[]) {
  return { type: 'FeatureCollection', features };
}

describe('importGeoJson', () => {
  it('merges two roads and a place onto the grid, remapping a collision and snapping endpoints', () => {
    const city = grid5x5();
    const before = structuredClone(city);
    const collision = Object.keys(city.roads)[0]!;
    const stableId = `r:${city.nextId}`;
    const result = importGeoJson(
      city,
      collection(
        road(
          [
            [-0.4, 0],
            [-60, 0],
          ],
          { 'cityflows:id': collision, lanes: 2, name: 'West' },
        ),
        road(
          [
            [-60, 0.5],
            [-120, 0],
          ],
          { 'cityflows:id': stableId, lanes: 3, oneway: false },
        ),
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-80, 10, 5] },
          properties: { kind: 'work', population: 0, jobs: 40, 'cityflows:id': 'p:500' },
        },
      ),
      { coordinates: 'local', snapToleranceM: 0.5 },
    );

    expect(city).toEqual(before);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const remapped = result.idMap[collision]!;
    expect(remapped).not.toBe(collision);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'geojson_id_remapped', refs: [collision, remapped] }),
    );
    expect(result.city.roads[collision]).toEqual(city.roads[collision]);
    const first = result.city.roads[remapped]!;
    const second = result.city.roads[stableId]!;
    expect(first.from).toBe('n:1');
    expect(first.centerline[0]).toEqual({ x: 0, y: 0 });
    expect(first.to).toBe(second.from);
    expect(second.centerline[0]).toEqual({ x: -60, y: 0 });
    expect(second.lanes).toHaveLength(2);
    const reverse = Object.values(result.city.roads).find(
      (road) => road.id !== second.id && road.streetGroupId === second.streetGroupId,
    );
    expect(reverse).toMatchObject({ from: second.to, to: second.from, lanes: [expect.anything()] });
    expect(result.city.places['p:500']).toMatchObject({
      kind: 'work',
      jobs: 40,
      shape: { kind: 'point', pos: { x: -80, y: 10 } },
    });
    expect(result.city.nextId).toBeGreaterThan(500);
    expect(result.city.version).toBe(city.version + 1);
    expect(compile(result.city).ok).toBe(true);
  });

  it('requires a geographic reference for longitude and latitude, then projects into meters', () => {
    const data = collection(
      road(
        [
          [-73, 40],
          [-73, 40.001],
        ],
        { 'cityflows:id': 'r:500' },
      ),
    );
    const city = grid5x5();
    expect(importGeoJson(city, data)).toMatchObject({
      ok: false,
      city: null,
      diagnostics: [expect.objectContaining({ code: 'geojson_missing_geo_reference' })],
    });
    const geo: City['geo'] = {
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
    const result = importGeoJson({ ...city, geo }, data);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.city.roads['r:500']!.from).toBe('n:1');
    const end = result.city.roads['r:500']!.centerline.at(-1)!;
    expect(end.x).toBe(0);
    expect(end.y).toBeCloseTo(-111.32, 2);
  });

  it('returns diagnostics without committing a partially imported city', () => {
    const city = grid5x5();
    const before = structuredClone(city);
    const valid = road([
      [-20, 0],
      [-40, 0],
    ]);
    const emptyPolygon = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[]] },
      properties: { kind: 'retail' },
    };
    for (const [bad, code] of [
      [emptyPolygon, 'geojson_invalid_collection'],
      [
        road(
          [
            [-50, 0],
            [-60, 0],
          ],
          { lanes: 0 },
        ),
        'geojson_invalid_feature',
      ],
      [
        road([
          [-50, 0],
          [-50, 0],
        ]),
        'road_degenerate',
      ],
    ] as const) {
      const result = importGeoJson(city, collection(valid, bad), { coordinates: 'local' });
      expect(result).toMatchObject({ ok: false, city: null, idMap: {} });
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ severity: 'error', code }),
      );
      expect(city).toEqual(before);
    }
  });
});
