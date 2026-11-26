// TASK-267 (TASK-259's D1, D2): one parking facility never fails or crashes an import.
import { expect, test } from 'vitest';
import { createGeoReference, localToLonLat } from '../../src/geo/projection';
import { importOsm } from '../../src/importers/osm';
import { compileDroppingParking } from '../../src/importers/osm/parking';
import { compile, type Diagnostic } from '../../src/network';
import { parkingWorld } from '../parking-world';

test.each(['lot', 'garage'] as const)(
  'TASK-267 a %s entry at its lane end compiles when the lane measures a few ulps shorter (D1)',
  (kind) => {
    const { city, id, street } = parkingWorld('lot');
    const facility = city.parking![id]!;
    facility.kind = kind;
    const first = compile(city);
    if (!first.ok) throw new Error(JSON.stringify(first.diagnostics));
    const lane = first.compiled.lanes[first.compiled.index.lane.get(`${street.id}#0`)!]!;
    // York's lot 1346647913 under left-hand traffic: snapped at 30.03074235393875 m, compiled
    // at 30.03074235393865 m.
    facility.connectors[0]!.positionM = lane.lengthM + 1e-13;
    const result = compile(city);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const entry =
      result.compiled.connectors[result.compiled.index.connector.get(facility.connectors[0]!.id)!]!;
    expect(entry.positionM).toBe(lane.lengthM);
    facility.connectors[0]!.positionM = lane.lengthM + 0.01;
    const beyond = compile(city);
    expect(beyond.ok).toBe(false);
    expect(beyond.diagnostics.find((d) => d.severity === 'error')).toMatchObject({
      code: 'parking_invalid',
      refs: [id],
    });
  },
);

test('TASK-267 the final compile drops and reports a facility it rejects, not the city', () => {
  const { city, id } = parkingWorld('lot');
  const diagnostics: Diagnostic[] = [];
  expect(compileDroppingParking(structuredClone(city), diagnostics).ok).toBe(true);
  expect(diagnostics).toEqual([]);
  city.parking![id]!.connectors[0]!.positionM = 5000;
  city.parking![id]!.provenance = { source: 'osm', osmIds: [42], inferred: ['driveway'] };
  expect(compile(city).ok).toBe(false);
  const result = compileDroppingParking(city, diagnostics);
  expect(result.ok).toBe(true);
  expect(city.parking![id]).toBeUndefined();
  expect(diagnostics).toEqual([
    expect.objectContaining({ severity: 'warning', code: 'parking_dropped', refs: [id] }),
  ]);
  expect(diagnostics[0]!.message).toContain('OSM 42');
});

test('TASK-267 a lot whose owner was a street-side area imports without that owner (D2)', () => {
  // Cambridge: Trinity College's lot (relation 2214067, no place of its own) touches only the
  // one-bay `parking=lane` area 681099117, which becomes a kerb strip and loses its place.
  const geo = createGeoReference({ lon: 0, lat: 0 });
  const points = [
    [0, 0],
    [120, 0],
    [30, 4],
    [70, 4],
    [70, 9],
    [30, 9],
    [30, 8],
    [70, 8],
    [70, 40],
    [30, 40],
  ];
  const nodes = points
    .map(([x, y], i) => {
      const p = localToLonLat(geo, { x: x!, y: y! });
      return `<node id="${i + 1}" lat="${p.lat}" lon="${p.lon}"/>`;
    })
    .join('');
  const xml = `<osm>${nodes}
    <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
    <way id="20"><nd ref="3"/><nd ref="4"/><nd ref="5"/><nd ref="6"/><nd ref="3"/><tag k="amenity" v="parking"/><tag k="parking" v="lane"/><tag k="capacity" v="1"/></way>
    <way id="30"><nd ref="7"/><nd ref="8"/><nd ref="9"/><nd ref="10"/><nd ref="7"/></way>
    <relation id="31"><member type="way" ref="30" role="outer"/><tag k="type" v="multipolygon"/><tag k="amenity" v="parking"/><tag k="parking" v="surface"/><tag k="access" v="private"/></relation></osm>`;
  for (const drivingSide of ['right', 'left'] as const) {
    const result = importOsm(xml, {
      importerVersion: 'test',
      bbox: [-0.002, -0.002, 0.002, 0.002],
      drivingSide,
      context: false,
      terrain: false,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const facilities = Object.values(result.city.parking ?? {});
    const lot = facilities.find((f) => f.provenance.osmIds?.includes(31))!;
    expect(lot).toMatchObject({ kind: 'lot', placeId: null });
    expect(lot.connectors).toHaveLength(1);
    expect(facilities.find((f) => f.provenance.osmIds?.includes(20))?.kind).toBe('roadside');
    expect(Object.values(result.city.places).filter((p) => p.kind === 'parking')).toEqual([]);
  }
});
